# Contributing to QueTal Cast

Thank you for your interest in contributing to QueTal Cast! Here are some guidelines to help you get started.

## Quick Start

1. **Fork the repository** on GitHub

2. **Clone your fork** and set up the project:
   ```bash
   git clone https://github.com/YOUR_USERNAME/quetalcast.git
   cd quetalcast
   pnpm install
   cd server && pnpm install && cd ..
   ```

3. **Run the app locally**:
   ```bash
   # Terminal 1 — server
   cd server && pnpm run dev

   # Terminal 2 — frontend
   pnpm run dev
   ```

4. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

## Development

- **Frontend**: React + Vite + TypeScript. Located in `src/`
- **Server**: Node.js + Express + WebSocket. Located in `server/`
- **Package manager**: `pnpm` 9 or newer. The repo root and `server/` are separate pnpm projects with their own lockfiles; run `pnpm install` in each

## Submitting Changes

1. **Make your changes** — ensure your code follows the existing style and patterns in the project

2. **Run tests** (if applicable):
   ```bash
   pnpm run test
   ```

3. **Commit your changes** — use clear, descriptive commit messages:
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

4. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

5. **Open a Pull Request** — go to the main repository and create a PR from your fork. Describe your changes clearly and reference any related issues.

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Update the README or help modal if you change user-facing behavior
- Ensure your changes are tested and working before submitting

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Questions?

If you have questions or want to discuss an idea before contributing, feel free to open an [issue](https://github.com/ktallp/quetalcast/issues) on GitHub.
