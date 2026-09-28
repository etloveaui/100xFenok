import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function atomicWrite(filePath, bytes) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let fd = null;
  try {
    fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(fd, bytes, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temporary, filePath);
    const directoryFd = fs.openSync(directory, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(directoryFd);
    } finally {
      fs.closeSync(directoryFd);
    }
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

export function writeJsonAtomic(filePath, document) {
  atomicWrite(filePath, `${JSON.stringify(document, null, 2)}\n`);
}

