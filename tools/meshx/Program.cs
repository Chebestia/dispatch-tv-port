// meshx: exporta mallas, materiales y texturas de UE4.27 cocinado (archivos sueltos ya extraídos) para el port web.
//   mallas    -> <out>/meshes/<Nombre>.glb   (coordenadas de hacking.js: three = (ue.y, ue.z, -ue.x), unidades UE)
//   materiales-> <out>/materials/<Nombre>.json (cadena de padres, parámetros escalares, de vector y de textura, modo de mezcla)
//   texturas  -> <out>/textures/<Nombre>.png
// Uso: meshx <work/extract> <salida> <lista.txt>   (una ruta de objeto por línea: /Game/..., /Engine/...)
using System.Text;
using System.Text.Json;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion.Meshes;
using CUE4Parse_Conversion.Textures;
using CUE4Parse_Conversion.Dto;
using CUE4Parse_Conversion.Options;

if (args.Length < 3) { Console.Error.WriteLine("uso: meshx <work/extract> <salida> <lista.txt>"); return 1; }
var (root, outDir, listPath) = (args[0], args[1], args[2]);

// El proveedor usa el nombre de la carpeta raíz como proyecto: uno con raíz <extract>/Dispatch (para /Game/ y plugins)
// y otro con raíz <extract>/Engine (para /Engine/).
// decodificador nativo para BC6/BC7 (viene embebido en CUE4Parse-Conversion)
CUE4Parse_Conversion.Textures.BC.DetexHelper.LoadDll();
CUE4Parse_Conversion.Textures.BC.DetexHelper.Initialize(CUE4Parse_Conversion.Textures.BC.DetexHelper.DLL_NAME);
var versions = new VersionContainer(EGame.GAME_UE4_27);
var provider = new DefaultFileProvider(Path.Combine(root, "Dispatch"), SearchOption.AllDirectories, true, versions);
provider.Initialize();
var engine = new DefaultFileProvider(Path.Combine(root, "Engine"), SearchOption.AllDirectories, true, versions);
engine.Initialize();
Console.WriteLine($"archivos sueltos: {provider.LooseFileCount} + {engine.LooseFileCount} (Engine), proyecto: {provider.ProjectName}");
if (Environment.GetEnvironmentVariable("MESHX_KEYS") is { } filter)
    foreach (var k in provider.Files.Keys.Where(k => k.Contains(filter, StringComparison.OrdinalIgnoreCase)).Take(10)) Console.WriteLine("  clave: " + k);

// modo JSON: meshx <extract> <salida> <lista.txt> json -> <salida>/<Paquete>.json con todos sus exports
// (serializador de CUE4Parse: entiende las estructuras nativas, p. ej. los canales de curvas de las LevelSequence)
if (args.Length > 3 && args[3] == "json")
{
    Directory.CreateDirectory(outDir);
    int ok = 0, bad = 0;
    foreach (var line in File.ReadAllLines(listPath).Select(l => l.Trim()).Where(l => l.Length > 0))
    {
        try
        {
            var file = ToFile(line);
            var p = file.StartsWith("Engine/") ? engine : provider;
            var exports = p.LoadPackage(file).GetExports().ToList();
            File.WriteAllText(Path.Combine(outDir, Path.GetFileName(file) + ".json"), Newtonsoft.Json.JsonConvert.SerializeObject(exports, Newtonsoft.Json.Formatting.Indented));
            ok++;
        }
        catch (Exception e) { bad++; Console.WriteLine($"  ERROR {line}: {e.Message}"); }
    }
    Console.WriteLine($"json {ok}, errores {bad}");
    return 0;
}

foreach (var d in new[] { "meshes", "materials", "textures" }) Directory.CreateDirectory(Path.Combine(outDir, d));
var done = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
var queue = new Queue<string>(File.ReadAllLines(listPath).Select(l => l.Trim()).Where(l => l.Length > 0));
int meshes = 0, materials = 0, textures = 0, errors = 0;

// "/Game/X/Y.Y" -> ruta de archivo que entiende el proveedor
string ToFile(string objectPath)
{
    var pkg = objectPath.Split('.')[0];
    if (pkg.StartsWith("Dispatch/") || pkg.StartsWith("Engine/")) return pkg; // GetPathName() ya da la ruta de archivo
    if (pkg.StartsWith("/Game/")) return "Dispatch/Content/" + pkg[6..];
    if (pkg.StartsWith("/Engine/")) return "Engine/Content/" + pkg[8..];
    // plugins: /DispatchEp101/... -> Dispatch/Plugins/DispatchEp101/Content/...
    var parts = pkg.TrimStart('/').Split('/', 2);
    return $"Dispatch/Plugins/{parts[0]}/Content/{parts[1]}";
}

while (queue.Count > 0)
{
    var objectPath = queue.Dequeue();
    if (!done.Add(objectPath)) continue;
    var name = objectPath.Split('.').Last();
    try
    {
        var file = ToFile(objectPath);
        var obj = (file.StartsWith("Engine/") ? engine : provider).LoadPackageObject(file + "." + name);
        switch (obj)
        {
            case UStaticMesh mesh:
                ExportMesh(mesh, name);
                meshes++;
                foreach (var m in mesh.Materials ?? []) if (m?.TryLoad(out var mo) == true && mo is UMaterialInterface mi) queue.Enqueue(mi.GetPathName());
                break;
            case UMaterialInterface mat:
                foreach (var dep in ExportMaterial(mat, name)) queue.Enqueue(dep);
                materials++;
                break;
            case UTexture2D tex:
                ExportTexture(tex, name);
                textures++;
                break;
            default:
                Console.WriteLine($"  sin exportar ({obj.ExportType}): {objectPath}");
                break;
        }
    }
    catch (Exception e)
    {
        errors++;
        Console.WriteLine($"  ERROR {objectPath}: {e.Message}");
    }
}
Console.WriteLine($"mallas {meshes}, materiales {materials}, texturas {textures}, errores {errors}");
return 0;

void ExportMesh(UStaticMesh mesh, string name)
{
    if (!MeshConverter.TryConvert(mesh, out StaticMeshDto dto, EMeshQuality.Highest, default, null) || dto.LODs.Count == 0)
        throw new Exception("no se pudo convertir la malla");
    var lod = dto.LODs[0];
    var matNames = (mesh.Materials ?? []).Select(m => m?.Name ?? "None").ToArray();
    WriteGlb(Path.Combine(outDir, "meshes", name + ".glb"), lod, matNames);
}

// glb mínimo: una malla con un primitive por sección (POSITION, NORMAL, TEXCOORD_0, índices uint32).
void WriteGlb(string file, MeshLodDto<MeshVertex> lod, string[] matNames)
{
    var bin = new MemoryStream();
    var bw = new BinaryWriter(bin);
    var accessors = new List<object>();
    var views = new List<object>();
    int View(long offset, long length, int? target) { views.Add(target is int t ? new { buffer = 0, byteOffset = offset, byteLength = length, target = t } : new { buffer = 0, byteOffset = offset, byteLength = length }); return views.Count - 1; }

    var v = lod.Vertices;
    float[] min = [float.MaxValue, float.MaxValue, float.MaxValue], max = [float.MinValue, float.MinValue, float.MinValue];
    long posOff = bin.Position;
    foreach (var x in v)
    {
        float[] p = [x.Position.Y, x.Position.Z, -x.Position.X];
        for (int i = 0; i < 3; i++) { bw.Write(p[i]); min[i] = Math.Min(min[i], p[i]); max[i] = Math.Max(max[i], p[i]); }
    }
    accessors.Add(new { bufferView = View(posOff, bin.Position - posOff, 34962), componentType = 5126, count = v.Length, type = "VEC3", min, max });
    long nOff = bin.Position;
    foreach (var x in v)
    {
        var n = new System.Numerics.Vector3(x.Normal.Y, x.Normal.Z, -x.Normal.X);
        n = n.LengthSquared() > 0 ? System.Numerics.Vector3.Normalize(n) : new System.Numerics.Vector3(0, 1, 0);
        bw.Write(n.X); bw.Write(n.Y); bw.Write(n.Z);
    }
    accessors.Add(new { bufferView = View(nOff, bin.Position - nOff, 34962), componentType = 5126, count = v.Length, type = "VEC3" });
    long uvOff = bin.Position;
    foreach (var x in v) { bw.Write(x.Uv.U); bw.Write(x.Uv.V); }
    accessors.Add(new { bufferView = View(uvOff, bin.Position - uvOff, 34962), componentType = 5126, count = v.Length, type = "VEC2" });

    var primitives = new List<object>();
    var materials = new List<object>();
    foreach (var s in lod.Sections)
    {
        long iOff = bin.Position;
        // el cambio de mano (Z arriba izquierdo -> Y arriba derecho) invierte el sentido de los triángulos
        for (int f = 0; f < s.NumFaces; f++)
        {
            int b = s.FirstIndex + f * 3;
            bw.Write(lod.Indices[b]); bw.Write(lod.Indices[b + 2]); bw.Write(lod.Indices[b + 1]);
        }
        accessors.Add(new { bufferView = View(iOff, bin.Position - iOff, 34963), componentType = 5125, count = s.NumFaces * 3, type = "SCALAR" });
        var matName = s.MaterialIndex >= 0 && s.MaterialIndex < matNames.Length ? matNames[s.MaterialIndex] : "None";
        // "slot|Nombre": el slot permite aplicar los OverrideMaterials de cada componente
        materials.Add(new { name = $"{s.MaterialIndex}|{matName}", doubleSided = lod.IsTwoSided });
        primitives.Add(new { attributes = new { POSITION = 0, NORMAL = 1, TEXCOORD_0 = 2 }, indices = accessors.Count - 1, material = materials.Count - 1 });
    }
    while (bin.Length % 4 != 0) bw.Write((byte)0);

    var gltf = new
    {
        asset = new { version = "2.0", generator = "meshx (CUE4Parse)" },
        scene = 0,
        scenes = new[] { new { nodes = new[] { 0 } } },
        nodes = new[] { new { mesh = 0, name = Path.GetFileNameWithoutExtension(file) } },
        meshes = new[] { new { name = Path.GetFileNameWithoutExtension(file), primitives } },
        materials,
        accessors,
        bufferViews = views,
        buffers = new[] { new { byteLength = bin.Length } },
    };
    var json = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(gltf));
    var pad = (4 - json.Length % 4) % 4;
    using var fs = File.Create(file);
    using var w = new BinaryWriter(fs);
    w.Write(0x46546C67u); w.Write(2u); w.Write((uint)(12 + 8 + json.Length + pad + 8 + bin.Length));
    w.Write((uint)(json.Length + pad)); w.Write(0x4E4F534Au); w.Write(json); for (int i = 0; i < pad; i++) w.Write((byte)' ');
    w.Write((uint)bin.Length); w.Write(0x004E4942u); w.Write(bin.ToArray());
}

// Parámetros de la instancia y de sus padres; el material base cocinado no trae el grafo.
IEnumerable<string> ExportMaterial(UMaterialInterface mat, string name)
{
    var deps = new List<string>();
    var chain = new List<object>();
    UMaterialInterface? cur = mat;
    for (int depth = 0; cur != null && depth < 8; depth++)
    {
        var scalars = new Dictionary<string, float>();
        var vectors = new Dictionary<string, float[]>();
        var texturesOut = new Dictionary<string, string>();
        if (cur is UMaterialInstanceConstant mic)
        {
            foreach (var p in mic.ScalarParameterValues ?? []) scalars[p.ParameterInfo.Name.Text] = p.ParameterValue;
            foreach (var p in mic.VectorParameterValues ?? []) if (p.ParameterValue is { } c) vectors[p.ParameterInfo.Name.Text] = [c.R, c.G, c.B, c.A];
            foreach (var p in mic.TextureParameterValues ?? [])
                if (p.ParameterValue.TryLoad(out var t) && t is UTexture tex) { texturesOut[p.ParameterInfo.Name.Text] = tex.Name; deps.Add(tex.GetPathName()); }
        }
        var props = new Dictionary<string, object?>();
        foreach (var key in new[] { "BlendMode", "ShadingModel", "TwoSided", "OpacityMaskClipValue", "bIsMasked" })
            if (cur.TryGetValue(out object value, key)) props[key] = value?.ToString();
        // texturas que usa el material (incluye las del material base)
        var used = new List<string>();
        foreach (var key in new[] { "CachedReferencedTextures", "ReferencedTextures" })
            foreach (var r in cur.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex[]>(key, []) ?? [])
                if (r.TryLoad(out var t) && t is UTexture tex && !used.Contains(tex.Name)) { used.Add(tex.Name); deps.Add(tex.GetPathName()); }
        if (cur.TryGetValue(out CUE4Parse.UE4.Assets.Objects.FStructFallback overrides, "BasePropertyOverrides"))
            foreach (var p in overrides.Properties) props["override." + p.Name.Text] = p.Tag?.GenericValue?.ToString();
        chain.Add(new { name = cur.Name, cls = cur.ExportType, scalars, vectors, textures = texturesOut, referencedTextures = used, props });
        cur = cur is UMaterialInstance inst ? inst.Parent as UMaterialInterface : null;
    }
    File.WriteAllText(Path.Combine(outDir, "materials", name + ".json"), JsonSerializer.Serialize(new { name, chain }, new JsonSerializerOptions { WriteIndented = true }));
    return deps;
}

void ExportTexture(UTexture2D tex, string name)
{
    var bitmap = TextureDecoder.Decode(tex, ETexturePlatform.DesktopMobile) ?? throw new Exception("no se pudo decodificar");
    var data = TextureEncoder.Encode(bitmap, ETextureFormat.Png, false, out var ext, 100);
    File.WriteAllBytes(Path.Combine(outDir, "textures", name + "." + ext), data);
}
