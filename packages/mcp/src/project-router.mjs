import path from "node:path";
import { createService } from "./service.mjs";
import { registerProject, resolveProjectPaths } from "./paths.mjs";

export class ProjectServiceRouter {
  constructor(options = {}) {
    this.defaultProjectRoot = options.projectRoot ?? process.env.MDFLOW_PROJECT_ROOT;
    this.activeProjectRoot = this.defaultProjectRoot;
    this.dataRoot = options.dataRoot ?? process.env.MDFLOW_DATA_DIR;
    this.maxEntries = options.maxEntries ?? 8;
    this.services = new Map();
  }

  projectRoot(input = {}) {
    return input.projectRoot ?? this.activeProjectRoot ?? this.defaultProjectRoot ?? process.cwd();
  }

  serviceFor(input = {}) {
    const paths = resolveProjectPaths({ projectRoot: this.projectRoot(input), dataRoot: this.dataRoot });
    const key = path.resolve(paths.projectRoot);
    this.activeProjectRoot = key;
    const cached = this.services.get(key);
    if (cached) {
      this.services.delete(key);
      this.services.set(key, cached);
      return cached;
    }

    const service = createService({ projectRoot: key, dataRoot: this.dataRoot });
    this.services.set(key, service);
    while (this.services.size > this.maxEntries) {
      const [oldestKey, oldestService] = this.services.entries().next().value;
      this.services.delete(oldestKey);
      oldestService.close();
    }
    return service;
  }

  register(input = {}) {
    const registered = registerProject(input);
    this.activeProjectRoot = registered.projectRoot;
    return registered;
  }

  close() {
    for (const service of this.services.values()) service.close();
    this.services.clear();
  }
}
