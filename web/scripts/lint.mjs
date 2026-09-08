import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const violations = [];

async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
            const source = await readFile(path, "utf8");
            for (const [lineNumber, line] of source.split(/\r?\n/).entries()) {
                if (/\bdebugger\b|console\.log\(|\/\/\s*(TODO|FIXME)\b/.test(line)) violations.push(`${relative(process.cwd(), path)}:${lineNumber + 1}`);
            }
        }
    }
}

await visit(root);
if (violations.length) {
    console.error(`lint violations: ${violations.join(", ")}`);
    process.exitCode = 1;
} else {
    console.log("lint passed: no debugger, console.log, TODO, or FIXME markers in TypeScript source");
}
