import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import boundaries from "eslint-plugin-boundaries";

/**
 * Hexagonal import boundaries (ARCHITECTURE.md §4):
 *   domain  -> domain only
 *   ports   -> domain/model, domain/errors
 *   adapters-> ports, domain/model, domain/errors
 *   app     -> domain, ports
 *   root    -> anything (the composition root)
 */
export default [
  js.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
    plugins: { "@typescript-eslint": tseslint, boundaries },
    settings: {
      "boundaries/elements": [
        { type: "domain", pattern: "src/domain/**" },
        { type: "ports", pattern: "src/ports/**" },
        { type: "adapters", pattern: "src/adapters/**" },
        { type: "app", pattern: "src/app/**" },
        { type: "root", pattern: "src/composition-root.ts" },
        { type: "entry", pattern: "src/cli.ts" },
      ],
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // tsc handles these far better than the core rules for TS sources
      "no-undef": "off",
      "no-redeclare": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: "domain", allow: ["domain"] },
            { from: "ports", allow: ["domain"] },
            { from: "adapters", allow: ["ports", "domain"] },
            { from: "app", allow: ["domain", "ports"] },
            { from: "root", allow: ["domain", "ports", "adapters", "app"] },
            { from: "entry", allow: ["domain", "ports", "adapters", "app", "root"] },
          ],
        },
      ],
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: { "boundaries/element-types": "off" },
  },
  { ignores: ["dist/**", "node_modules/**", "fixtures/**", "*.config.*"] },
];
