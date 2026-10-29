//! Extractor de paks UE4.27 (v11) con AES y Oodle/Zlib.
//! Uso: pakx <dirPaks> <keyHex> <inventory.json> <outDir> <regex>
//! inventory.json lo genera tools/pakinv.js: files = [pak, ruta, size, usize, offset].

use aes::cipher::{generic_array::GenericArray, BlockDecrypt, KeyInit};
use aes::Aes256;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

struct Job {
    pak: String,
    path: String,
    offset: u64,
}

fn decrypt(aes: &Aes256, buf: &mut [u8]) {
    for block in buf.chunks_exact_mut(16) {
        aes.decrypt_block(GenericArray::from_mut_slice(block));
    }
}

fn align16(n: u64) -> u64 {
    (n + 15) & !15
}

fn rd_u32(b: &[u8], p: &mut usize) -> u32 {
    let v = u32::from_le_bytes(b[*p..*p + 4].try_into().unwrap());
    *p += 4;
    v
}

fn rd_u64(b: &[u8], p: &mut usize) -> u64 {
    let v = u64::from_le_bytes(b[*p..*p + 8].try_into().unwrap());
    *p += 8;
    v
}

fn extract(aes: &Aes256, pak: &mut File, offset: u64) -> Result<Vec<u8>, String> {
    pak.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut h = vec![0u8; 64 * 1024];
    let n = pak.read(&mut h).map_err(|e| e.to_string())?;
    h.truncate(n);
    let mut p = 0;
    let _off = rd_u64(&h, &mut p);
    let size = rd_u64(&h, &mut p);
    let usize_ = rd_u64(&h, &mut p);
    let comp = rd_u32(&h, &mut p);
    p += 20; // hash
    let mut blocks = Vec::new();
    if comp != 0 {
        let nb = rd_u32(&h, &mut p);
        // videos largos: la tabla de bloques (16 bytes por bloque) no entra en los 64 KB leídos; releer lo necesario
        let need = p + nb as usize * 16 + 5;
        if need > h.len() {
            h = vec![0u8; need];
            pak.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
            pak.read_exact(&mut h).map_err(|e| e.to_string())?;
        }
        for _ in 0..nb {
            let s = rd_u64(&h, &mut p);
            let e = rd_u64(&h, &mut p);
            blocks.push((s, e));
        }
    }
    let flags = h[p];
    p += 1;
    let block_size = rd_u32(&h, &mut p) as u64;
    let encrypted = flags & 1 != 0;
    let header_len = p as u64;

    if comp == 0 {
        let len = if encrypted { align16(size) } else { size };
        let mut data = vec![0u8; len as usize];
        pak.seek(SeekFrom::Start(offset + header_len)).map_err(|e| e.to_string())?;
        pak.read_exact(&mut data).map_err(|e| e.to_string())?;
        if encrypted {
            decrypt(aes, &mut data);
        }
        data.truncate(usize_ as usize);
        return Ok(data);
    }

    let mut out = Vec::with_capacity(usize_ as usize);
    let mut ext = oozextract::Extractor::new();
    for (s, e) in blocks {
        let raw = e - s;
        let len = if encrypted { align16(raw) } else { raw };
        let mut data = vec![0u8; len as usize];
        pak.seek(SeekFrom::Start(offset + s)).map_err(|e| e.to_string())?;
        pak.read_exact(&mut data).map_err(|e| e.to_string())?;
        if encrypted {
            decrypt(aes, &mut data);
        }
        let data = &data[..raw as usize];
        let want = block_size.min(usize_ - out.len() as u64) as usize;
        match comp {
            1 => {
                let start = out.len();
                out.resize(start + want, 0);
                let got = ext
                    .read_from_slice(data, &mut out[start..])
                    .map_err(|e| format!("oodle: {e:?}"))?;
                out.truncate(start + got);
            }
            2 => {
                let mut d = flate2::read::ZlibDecoder::new(data);
                d.read_to_end(&mut out).map_err(|e| e.to_string())?;
            }
            m => return Err(format!("método de compresión {m} desconocido")),
        }
    }
    Ok(out)
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() < 6 {
        eprintln!("uso: pakx <dirPaks> <keyHex> <inventory.json> <outDir> <regex>");
        std::process::exit(2);
    }
    let key_hex = a[2].trim().trim_start_matches("0x");
    let key: Vec<u8> = (0..32)
        .map(|i| u8::from_str_radix(&key_hex[i * 2..i * 2 + 2], 16).unwrap())
        .collect();
    let aes = Aes256::new(GenericArray::from_slice(&key));
    let inv: serde_json::Value = serde_json::from_slice(&fs::read(&a[3]).unwrap()).unwrap();
    // "!" al principio invierte el filtro (el crate regex no tiene lookahead)
    let (invert, pattern) = match a[5].strip_prefix('!') {
        Some(p) => (true, p),
        None => (false, a[5].as_str()),
    };
    let re = regex::Regex::new(&format!("(?i){pattern}")).unwrap();
    let jobs: Vec<Job> = inv["files"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| re.is_match(f[1].as_str().unwrap()) != invert)
        // retomar: saltear lo que ya quedó extraído completo. Mismo tamaño no alcanza: tras una actualización del juego un
        // .uexp puede cambiar sin cambiar de tamaño (pasó el 23/10), así que además tiene que ser más nuevo que su pak
        .filter(|f| {
            let out = Path::new(&a[4]).join(f[1].as_str().unwrap());
            let pak_time = fs::metadata(Path::new(&a[1]).join(f[0].as_str().unwrap())).and_then(|m| m.modified()).ok();
            match fs::metadata(out) {
                Ok(m) => m.len() != f[3].as_u64().unwrap() || match (m.modified().ok(), pak_time) { (Some(o), Some(p)) => o < p, _ => true },
                Err(_) => true,
            }
        })
        .map(|f| Job {
            pak: f[0].as_str().unwrap().to_string(),
            path: f[1].as_str().unwrap().to_string(),
            offset: f[4].as_u64().unwrap(),
        })
        .collect();
    println!("{} archivos", jobs.len());

    let jobs = Arc::new(jobs);
    let next = Arc::new(AtomicUsize::new(0));
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    let handles: Vec<_> = (0..threads)
        .map(|_| {
            let (jobs, next, aes) = (jobs.clone(), next.clone(), aes.clone());
            let (dir, out_dir) = (a[1].clone(), a[4].clone());
            std::thread::spawn(move || {
                let mut errors = 0;
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(j) = jobs.get(i) else { break };
                    let mut pak = File::open(Path::new(&dir).join(&j.pak)).unwrap();
                    match extract(&aes, &mut pak, j.offset) {
                        Ok(data) => {
                            let out = Path::new(&out_dir).join(&j.path);
                            fs::create_dir_all(out.parent().unwrap()).unwrap();
                            File::create(&out).unwrap().write_all(&data).unwrap();
                        }
                        Err(e) => {
                            eprintln!("ERROR {}: {e}", j.path);
                            errors += 1;
                        }
                    }
                }
                errors
            })
        })
        .collect();
    let errors: usize = handles.into_iter().map(|h| h.join().unwrap()).sum();
    println!("listo, {errors} errores");
}
