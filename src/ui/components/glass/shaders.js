async function fetchShader(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load shader: ${url}`);
  return res.text();
}

let _glassSrcs = null;

export async function getGlassSrcs() {
  if (!_glassSrcs) {
    const base = new URL('../../../shaders/glass/', import.meta.url);
    _glassSrcs = await Promise.all([
      fetchShader(new URL('vert.glsl', base)),
      fetchShader(new URL('frag.glsl', base)),
    ]);
  }
  return _glassSrcs;
}
