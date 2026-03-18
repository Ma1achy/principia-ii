#!/usr/bin/env node

/**
 * Debug Helper Script
 * Run common diagnostic checks
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 Principia Debug Helper\n');

// Check Node/NPM versions
console.log('📦 Environment:');
try {
  const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
  const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
  console.log(`  Node: ${nodeVersion}`);
  console.log(`  NPM: ${npmVersion}`);
} catch (err) {
  console.log('  ❌ Error checking versions');
}

// Check if node_modules exists
console.log('\n📂 Dependencies:');
if (fs.existsSync('node_modules')) {
  console.log('  ✅ node_modules exists');
  
  // Check key packages
  const packages = ['typescript', 'vite', '@webgpu/types'];
  packages.forEach(pkg => {
    const pkgPath = path.join('node_modules', pkg);
    if (fs.existsSync(pkgPath)) {
      console.log(`  ✅ ${pkg} installed`);
    } else {
      console.log(`  ❌ ${pkg} missing`);
    }
  });
} else {
  console.log('  ❌ node_modules missing - run: npm install');
}

// Check critical files
console.log('\n📄 Configuration:');
const configFiles = [
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'index.html',
  'src/main.js'
];

configFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`  ✅ ${file}`);
  } else {
    console.log(`  ❌ ${file} missing`);
  }
});

// Check TypeScript
console.log('\n🔧 TypeScript:');
try {
  execSync('npx tsc --version', { encoding: 'utf8', stdio: 'pipe' });
  console.log('  ✅ TypeScript available');
  
  console.log('\n  Running type check...');
  try {
    const output = execSync('npx tsc --noEmit', { encoding: 'utf8', stdio: 'pipe' });
    console.log('  ✅ No type errors');
  } catch (err) {
    console.log('  ⚠️  Type errors found:');
    console.log(err.stdout || err.stderr);
  }
} catch (err) {
  console.log('  ❌ TypeScript not available');
}

// Count files
console.log('\n📊 Project Stats:');
const countFiles = (dir, ext) => {
  try {
    const files = execSync(`find ${dir} -name "*.${ext}" 2>/dev/null | wc -l`, { encoding: 'utf8' }).trim();
    return parseInt(files) || 0;
  } catch {
    return 0;
  }
};

console.log(`  JavaScript files: ${countFiles('src', 'js')}`);
console.log(`  TypeScript files: ${countFiles('src', 'ts')}`);
console.log(`  CSS files: ${countFiles('src', 'css')}`);

console.log('\n✨ Debug check complete!\n');
