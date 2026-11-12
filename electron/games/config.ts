// Reads and patches single keys in game and app config files, leaving every other line as it was.
//   ini:   [Section] then key=value (Unreal Engine GameUserSettings.ini, OBS global.ini)
//   kv:    "key"  "value" lines (Valve/Respawn videoconfig.txt, cs2_video.txt); nesting ignored, keys are unique
//   cfg:   key "value" lines (Apex settings.cfg)
//   xml:   <type name="key">value</type> lines (Roblox GlobalBasicSettings)
//   prefs: key=value lines, no sections (Spotify prefs). The only line format that may add a missing key.
//   colon: key:value lines (Minecraft options.txt)
//   json:  a.b.c = nested keys (Discord settings.json, Chromium Local State)
export type ConfigFormat = 'ini' | 'kv' | 'cfg' | 'xml' | 'prefs' | 'colon' | 'json';
export type ConfigValue = string | number | boolean;
type LineFormat = Exclude<ConfigFormat, 'json'>;

// Groups: 1 lead, 2 key, 3 separator, 4 value, 5 trail.
const LINE: Record<LineFormat, RegExp> = {
  ini: /^(\s*)([^=;#[\s][^=]*?)(\s*=\s*)(.*?)(\s*)$/,
  prefs: /^(\s*)([^=#\s][^=]*?)(=)(.*?)(\s*)$/,
  colon: /^(\s*)([^:#\s][^:]*?)(:)(.*?)(\s*)$/,
  kv: /^(\s*)"([^"]+)"(\s+)"([^"]*)"(\s*)$/,
  cfg: /^(\s*)([^\s"]+)(\s+)"([^"]*)"(\s*)$/,
  xml: /^(\s*<\w+ name=")([^"]+)(">)([^<]*)(<\/\w+>\s*)$/,
};

function find(lines: string[], format: LineFormat, section: string | undefined, name: string) {
  let cur: string | undefined;
  const want = name.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const sec = format === 'ini' ? /^\s*\[(.*)\]\s*$/.exec(lines[i]) : null;
    if (sec) {
      cur = sec[1];
      continue;
    }
    const m = LINE[format].exec(lines[i]);
    if (m && m[2].toLowerCase() === want && (format !== 'ini' || cur === section)) return { i, m };
  }
  return null;
}

/** null = the key is not in the file. */
export function getKey(text: string, format: ConfigFormat, section: string | undefined, name: string): ConfigValue | null {
  if (format === 'json') {
    let v: unknown = JSON.parse(text);
    for (const part of name.split('.')) v = typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[part] : undefined;
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null;
  }
  return find(text.split(/\r?\n/), format, section, name)?.m[4] ?? null;
}

/**
 * Returns the text with one key changed (null = removed). Most line formats only change keys that
 * already exist: adding a key a game doesn't know is a guess, so that throws.
 */
export function setKey(text: string, format: ConfigFormat, section: string | undefined, name: string, value: ConfigValue | null): string {
  if (format === 'json') {
    const root = JSON.parse(text) as Record<string, unknown>;
    const parts = name.split('.');
    let obj = root;
    for (const part of parts.slice(0, -1)) {
      if (typeof obj[part] !== 'object' || obj[part] === null) {
        if (value === null) return text;
        obj[part] = {};
      }
      obj = obj[part] as Record<string, unknown>;
    }
    if (value === null) delete obj[parts.at(-1)!];
    else obj[parts.at(-1)!] = value;
    return text.includes('\n') ? JSON.stringify(root, null, 2) : JSON.stringify(root); // keep minified files minified
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const hit = find(lines, format, section, name);
  if (!hit) {
    if (value === null) return text;
    if (format !== 'prefs') throw new Error(`"${name}" is not in this file`);
    const end = lines.at(-1) === '' ? lines.length - 1 : lines.length;
    lines.splice(end, 0, `${name}=${value}`);
    return lines.join(eol);
  }
  if (value === null) lines.splice(hit.i, 1);
  else {
    const [, lead, key, sep, , trail] = hit.m;
    lines[hit.i] = format === 'kv' ? `${lead}"${key}"${sep}"${value}"${trail}` : format === 'cfg' ? `${lead}${key}${sep}"${value}"${trail}` : `${lead}${key}${sep}${value}${trail}`;
  }
  return lines.join(eol);
}
