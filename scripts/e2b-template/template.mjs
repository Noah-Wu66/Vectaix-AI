import { Template } from "e2b";

export function createVectaixTemplate() {
  return Template()
    .fromImage("python:3.11-slim")
    .setUser("user")
    .setWorkdir("/home/user")
    .aptInstall(["antiword"])
    .pipInstall(["pypdf", "python-docx", "openpyxl", "xlrd==1.2.0"])
    .copy("scripts/e2b-template/parser/parse_attachment.py", "/home/user/vectaix/bin/parse_attachment.py");
}
