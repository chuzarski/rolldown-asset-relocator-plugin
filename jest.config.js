module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/*(*.)+(spec|test).js"],
  testPathIgnorePatterns: ["/node_modules/", "/test/transform/", "/test/e2e/"],
  // The fixtures ship several package.json files with the same name on purpose;
  // jest's haste map warns about the collision and nothing here resolves through
  // it, so keep them out of the map entirely.
  modulePathIgnorePatterns: ["<rootDir>/test/transform/", "<rootDir>/test/e2e/"]
};
