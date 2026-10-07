import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    ignores: [
      ".next/**",
      ".next-dev/**",
      ".next-dev-*/**",
      "node_modules/**",
      "private/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
