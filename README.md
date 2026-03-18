# Principia

A three-body problem visualization and simulation engine with interactive UI.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 📦 Tech Stack

- **TypeScript** - Type-safe JavaScript (incremental migration in progress)
- **Vite** - Fast build tool and dev server
- **WebGPU** - Next-gen GPU API for high-performance rendering
- **Three.js** - 3D rendering library (simulation being rewritten)
- **Vanilla JS/TS** - No framework, just modern web standards

## 📁 Project Structure

```
principia/
├── src/
│   ├── main.js              # Entry point
│   ├── state.js             # Application state
│   ├── renderer.js          # [DEPRECATED] Being rewritten
│   ├── ui/                  # UI components and builders
│   ├── navigation/          # Keyboard navigation system
│   ├── Chazy/               # Smart subtitle/interaction system
│   └── interaction/         # User interaction tracking
├── docs/                    # Documentation
│   ├── TYPESCRIPT_MIGRATION.md
│   ├── TYPES_REFERENCE.md
│   └── TS_MIGRATION_CHECKLIST.md
├── index.html               # Main HTML
└── style.css                # Global styles
```

## 🔧 Development

### TypeScript Migration

This project is being gradually migrated to TypeScript. JavaScript and TypeScript files coexist. See:

- **[TYPESCRIPT_MIGRATION.md](docs/TYPESCRIPT_MIGRATION.md)** - Complete migration guide
- **[TYPES_REFERENCE.md](docs/TYPES_REFERENCE.md)** - Type definitions
- **[TS_MIGRATION_CHECKLIST.md](docs/TS_MIGRATION_CHECKLIST.md)** - Progress tracking

### Scripts

- `npm run dev` - Start dev server at http://localhost:3000
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run type-check` - Check TypeScript types without building

### Code Style

- 2 spaces for indentation
- Modern ES6+ JavaScript/TypeScript
- Use semicolons
- See `.editorconfig` for details

## 🎯 Features

- **Interactive 3D Visualization** - Three-body problem simulation
- **Keyboard Navigation** - Full keyboard control with semantic UI tree
- **Smart Subtitle System (Chazy)** - Context-aware interaction feedback
- **Custom UI Components** - Glass-morphic controls and panels
- **State Management** - URL-based state encoding/decoding
- **Responsive Design** - Works across screen sizes

## 📚 Documentation

- **[README_TYPESCRIPT.md](README_TYPESCRIPT.md)** - TypeScript setup guide
- **[docs/](docs/)** - Full documentation folder

## 🛠️ Current Status

- ✅ TypeScript configuration complete
- ✅ Navigation system implemented
- ✅ Chazy interaction system working
- 🔄 TypeScript migration in progress (~0% complete)
- 🔄 Simulation/renderer being rewritten

## 🤝 Contributing

This is a personal project, but feel free to explore the code and learn from it!

## 📝 License

Private project - all rights reserved.
