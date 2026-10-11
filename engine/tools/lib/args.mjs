// CLI argument parsing (kept separate so tests can import it without running the CLI).
/** tiny argv parser: positionals + --flag [value]; BOOL flags never take a value */
const BOOL = new Set(['scenes', 'web-only', 'audio-only', 'stems', 'no-build', 'quiet', 'help', 'json', 'no-install', 'dry-run', 'verbose', 'need-key', 'nokey', 'keep-mix', 'analyse-only', 'force', 'all', 'png']);
/** flags that may repeat: values accumulate into an array (--ref a.png --ref b.png) */
const MULTI = new Set(['ref']);
export function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      let val;
      if (v !== undefined) val = v;
      else if (BOOL.has(k) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) val = true;
      else val = argv[++i];
      flags[k] = MULTI.has(k) ? [...(flags[k] ?? []), val] : val;
    } else pos.push(a);
  }
  return { pos, flags };
}
