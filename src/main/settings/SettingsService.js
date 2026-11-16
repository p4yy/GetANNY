const fs = require("node:fs/promises");
const { defaults, validateSetting } = require("./schema");
class SettingsService {
  constructor({ repo, downloadPath, onChange = () => {} }) {
    this.repo = repo;
    this.defaults = defaults(downloadPath);
    this.onChange = onChange;
    this.values = { ...this.defaults };
    // Discard invalid legacy values instead of breaking startup.
    const saved = repo.getAll();
    if (Object.hasOwn(saved, "avEngineEnabled")) repo.delete("avEngineEnabled");
    for (let [key, value] of Object.entries(saved)) {
      if (key === "theme" && value === "dark") value = "graphite";
      try {
        this.values[key] = validateSetting(key, value);
      } catch {
        /* unsupported legacy preference */
      }
    }
    // 122 was accidentally saved as the shipped simultaneous-download
    // default. Correct that specific bad default while preserving other
    // deliberately chosen concurrency values.
    if (saved.maxConcurrentDownloads === 122) {
      this.values.maxConcurrentDownloads = this.defaults.maxConcurrentDownloads;
      repo.set("maxConcurrentDownloads", this.defaults.maxConcurrentDownloads);
    }
    // Preserve the old accessibility preference when upgrading existing users.
    if (saved.animationMode === undefined && saved.reduceMotion === true)
      this.values.animationMode = "reduced";
  }
  getAll() {
    return { ...this.values };
  }
  get(key) {
    return this.values[key];
  }
  async set(key, value) {
    validateSetting(key, value);
    if (key === "defaultDownloadPath") {
      await fs.mkdir(value, { recursive: true });
      await fs.access(value, fs.constants.W_OK);
    }
    await this.onChange(key, value);
    this.repo.set(key, value);
    this.values[key] = value;
    return value;
  }
  async reset() {
    for (const [key, value] of Object.entries(this.defaults))
      if (key !== "firstRunCompleted") await this.set(key, value);
    return this.getAll();
  }
}
module.exports = { SettingsService };
