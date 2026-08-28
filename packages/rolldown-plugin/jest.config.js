module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/*(*.)+(spec|test).js"],
  testPathIgnorePatterns: ["/node_modules/", "/test/transform/", "/test/e2e/"]
};
