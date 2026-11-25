---
name: Use pnpm not npm
description: This project uses pnpm as package manager
type: feedback
---

This project uses pnpm, not npm. Always use `pnpm add` instead of `npm install`.

**Why:** pnpm-lock.yaml exists, not package-lock.json.
**How to apply:** Any time you need to install a package in this project, use `pnpm add <package>`.
