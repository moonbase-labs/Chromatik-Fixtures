#!/usr/bin/env bun
// Symlink every fixture in fixtures/ into ~/Chromatik/Fixtures/, where Chromatik looks for them.
//
// Links go straight into Fixtures/, not a subfolder, because a fixture's file name is the type name
// that projects store. Linking rather than copying means a `git pull` updates what Chromatik sees;
// re-run this only when a fixture is added, renamed or removed.
//
// Safe to re-run. A link already pointing here is left alone, and a real file is only replaced when
// it is an identical copy, so nothing edited locally is lost.
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

const source = resolve(import.meta.dir, "../fixtures");
const target = join(homedir(), "Chromatik", "Fixtures");
mkdirSync(target, { recursive: true });

const linkTarget = (path: string) => {
  try {
    return lstatSync(path).isSymbolicLink() ? resolve(target, readlinkSync(path)) : null;
  } catch {
    return null;
  }
};

let problems = 0;
for (const name of readdirSync(source).filter((n) => n.endsWith(".lxf")).sort()) {
  const from = join(source, name);
  const to = join(target, name);
  const current = linkTarget(to);

  if (current === from) {
    console.log(`ok        ${name}`);
    continue;
  }
  if (current !== null) {
    unlinkSync(to);
    console.log(`relinking ${name}, was ${current}`);
  } else if (existsSync(to)) {
    if ((await Bun.file(to).text()) !== (await Bun.file(from).text())) {
      console.warn(`skipped   ${name}: a different file is already there, move it aside and re-run`);
      problems++;
      continue;
    }
    unlinkSync(to);
  }

  try {
    symlinkSync(from, to);
    console.log(`linked    ${name}`);
  } catch (error: any) {
    const hint = process.platform === "win32" && error.code === "EPERM" ? " (turn on Developer Mode to allow symlinks)" : "";
    console.error(`failed    ${name}: ${error.message}${hint}`);
    problems++;
  }
}

// Links left behind by a fixture that has since been renamed or deleted in the repo.
for (const name of readdirSync(target)) {
  const current = linkTarget(join(target, name));
  if (current?.startsWith(source + sep) && !existsSync(current)) {
    unlinkSync(join(target, name));
    console.log(`removed   ${name}, no longer in the repo`);
  }
}

process.exitCode = problems ? 1 : 0;
