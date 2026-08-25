import { existsSync } from "fs";
import path from "path";
import {
  createProject,
  listProjects,
  saveDocument,
  getDocument,
} from "../src/lib/storage";

async function main() {
  const projects = await listProjects();
  const project =
    projects[0] ?? (await createProject("CAD smoke", ""));
  const dxf = Buffer.from("0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n");
  const doc = await saveDocument({
    projectId: project.id,
    originalName: "test-plan.dxf",
    buffer: dxf,
  });
  const root = process.env.DATA_ROOT || process.cwd();
  const filePath = path.join(root, "uploads", doc.storedName);
  console.log(
    JSON.stringify(
      {
        id: doc.id,
        originalName: doc.originalName,
        storedName: doc.storedName,
        mimeType: doc.mimeType,
        pageCount: doc.pageCount,
        exists: existsSync(filePath),
        filePath,
      },
      null,
      2,
    ),
  );
  const loaded = await getDocument(doc.id);
  if (!loaded) throw new Error("getDocument failed");
  if (!doc.storedName.endsWith(".dxf")) throw new Error("storedName not .dxf");
  if (doc.pageCount !== 0) throw new Error("CAD pageCount should be 0");
  if (!existsSync(filePath)) throw new Error("file missing on disk");
  console.log("smoke ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
