// stamp.mjs — writes the current git HEAD into version.js.
//
//   node scripts/stamp.mjs
//
// Run this AFTER committing app code, then commit the result. Because that
// commit only touches version.js, the SHA displayed in the app footer
// identifies the app code exactly, with no off-by-one from the usual
// "stamp then commit" chicken-and-egg.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
const file = fileURLToPath(new URL('../version.js', import.meta.url));
const src = readFileSync(file, 'utf8');

const DECL = /const BUILD_ID = '[^']*';/;
if (!DECL.test(src)) {
  console.error('stamp: could not find the BUILD_ID declaration in version.js');
  process.exit(1);
}

const current = (src.match(DECL)[0].match(/'([^']*)'/))[1];
writeFileSync(file, src.replace(DECL, `const BUILD_ID = '${sha}';`));
console.log(current === sha
  ? `BUILD_ID already ${sha} (unchanged)`
  : `stamped BUILD_ID ${current} -> ${sha}`);