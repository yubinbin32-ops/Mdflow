import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function findProjectRoot(startDirectory = process.cwd()) {
  let current = path.resolve(startDirectory);
  while (true) {
    if (fs.existsSync(path.join(current, ".mdflow", "project.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`No .mdflow/project.json found above ${startDirectory}`);
    }
    current = parent;
  }
}

export function readProjectDescriptor(projectRoot) {
  const descriptorPath = path.join(projectRoot, ".mdflow", "project.json");
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
  if (!descriptor.id || !descriptor.name) {
    throw new Error(`${descriptorPath} must contain id and name`);
  }
  return descriptor;
}

export function resolveProjectPaths(options = {}) {
  const projectRoot = findProjectRoot(
    options.projectRoot ?? process.env.MDFLOW_PROJECT_ROOT ?? process.cwd(),
  );
  const descriptor = readProjectDescriptor(projectRoot);
  const dataRoot = path.resolve(
    options.dataRoot ??
      process.env.MDFLOW_DATA_DIR ??
      path.join(os.homedir(), "Library", "Application Support", "mdflow", "projects"),
  );
  const projectDataDirectory = path.join(dataRoot, descriptor.id);
  fs.mkdirSync(projectDataDirectory, { recursive: true });

  return {
    projectRoot,
    descriptor,
    dataRoot,
    projectDataDirectory,
    databasePath: path.join(projectDataDirectory, "mdflow.sqlite"),
  };
}
