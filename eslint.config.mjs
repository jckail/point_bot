// @ts-check
import { defineConfig, globalIgnores } from "eslint/config";
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

export default defineConfig([
  globalIgnores([
    "**/.next/**",
    "**/node_modules/**",
    "**/dist/**",
    "infra/cdk.out/**",
    "packages/core/drizzle/**",
    "apps/web/next-env.d.ts",
  ]),
  ...coreWebVitals,
  ...typescript,
  {
    settings: {
      next: {
        rootDir: "apps/web/",
      },
    },
  },
  {
    // A leading underscore marks an intentionally unused parameter or
    // variable (route handlers' `_request`, fakes that mirror a signature).
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Type-aware rules (typescript-eslint projectService). Scoped to the
    // workspaces that have a tsconfig; scripts/e2e/infra are linted untyped.
    files: [
      "packages/*/src/**/*.{ts,tsx}",
      "packages/*/test/**/*.ts",
      "apps/*/src/**/*.{ts,tsx}",
      "apps/*/test/**/*.ts",
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A union member added without handling it here is a lint error even
      // where `assertNever` is absent (with a default branch, it is allowed
      // only when the default really is the catch-all for non-union input).
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      // An un-awaited promise swallows its rejection; use `void` + a catch
      // for deliberate fire-and-forget.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports", disallowTypeAnnotations: false },
      ],
    },
  },
]);
