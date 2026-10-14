// Read one file at a ref without cloning.
export async function readConfig(env: Env, name: string, ref = "main") {
  using repo = await env.ARTIFACTS.get(name);
  const file = await repo.readFile({ ref, path: ".app/config.json" });
  return file ? JSON.parse(await file.text()) : null;
}
