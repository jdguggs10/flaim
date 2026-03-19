import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
  // Block non-chat code from importing chat modules
  {
    ignores: [
      "components/chat/**",
      "lib/chat/**",
      "stores/chat/**",
      "app/(chat)/**",
      "app/api/chat/**",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@/components/chat/*"], message: "Only chat code may import chat components." },
          { group: ["@/lib/chat/*"], message: "Only chat code may import chat libraries." },
          { group: ["@/stores/chat/*"], message: "Only chat code may import chat stores." },
        ]
      }]
    },
  },
  // Block chat code from importing site components
  {
    files: [
      "components/chat/**",
      "lib/chat/**",
      "stores/chat/**",
      "app/(chat)/**",
      "app/api/chat/**",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@/components/site/*"], message: "Chat code must not import site components." },
        ]
      }]
    },
  },
];

export default eslintConfig;
