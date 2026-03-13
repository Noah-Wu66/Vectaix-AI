import { Template } from "e2b";

export function createVectaixTemplate() {
  return Template
    .fromBaseImage("python:3.11-slim")
    .setStartCmd("python3 --version")
    .setUser("user")
    .setWorkdir("/home/user")
    .run("apt-get update && apt-get install -y antiword && rm -rf /var/lib/apt/lists/*")
    .run("python3 -m pip install --no-cache-dir pypdf python-docx openpyxl xlrd==1.2.0")
    .addFile("scripts/e2b-template/parser/parse_attachment.py", "/home/user/vectaix/bin/parse_attachment.py");
}
