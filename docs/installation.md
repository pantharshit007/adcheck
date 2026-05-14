# Installation & Development

### Prerequisites

- Node.js and npm

### Local Setup

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```

### Build Commands

- **Build Extension**: Compiles TypeScript and copies static assets to the `dist/` directory.
  ```bash
   npm run build
  ```
- **Typecheck**: Validate TypeScript types.
  ```bash
   npm run typecheck
  ```
- **Generate Icons**: Re-generate extension icons from source assets.
  ```bash
   npm run generate:icons
  ```

### Loading the Extension

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select the `dist/` folder in this repository.
