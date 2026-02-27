import nextConfig from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  { ignores: ["website/**"] },
  ...nextConfig,
  ...nextTs,
  {
    rules: {
      // Allow underscore-prefixed vars and rest-sibling destructuring (e.g. { passwordHash, ...rest })
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // React Hook Form's watch() is intentionally incompatible with the React Compiler;
      // suppress the advisory warning project-wide.
      "react-hooks/incompatible-library": "off",
      // Resetting state inside useEffect when a prop/flag changes is a common and
      // intentional pattern in dialog components; suppress the advisory rule.
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default config;
