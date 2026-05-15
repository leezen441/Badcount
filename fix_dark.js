const fs = require('fs');

function addDark(str, target, addition) {
  const regex = new RegExp('class="([^"]*?' + target + '[^"]*?)"', 'g');
  return str.replace(regex, (match, p1) => {
    const classes = p1.split(/\s+/);
    if (classes.includes(target) && !classes.includes(addition)) {
      classes.splice(classes.indexOf(target) + 1, 0, addition);
    }
    return 'class="' + classes.join(' ') + '"';
  });
}

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  content = addDark(content, 'bg-white', 'dark:bg-slate-800');
  content = addDark(content, 'bg-slate-50', 'dark:bg-slate-900/50');
  content = addDark(content, 'bg-slate-100', 'dark:bg-slate-800');
  content = addDark(content, 'bg-slate-200', 'dark:bg-slate-700');

  content = addDark(content, 'text-slate-800', 'dark:text-slate-200');
  content = addDark(content, 'text-slate-700', 'dark:text-slate-300');
  content = addDark(content, 'text-slate-600', 'dark:text-slate-400');
  content = addDark(content, 'text-slate-500', 'dark:text-slate-400');

  content = addDark(content, 'border-slate-100', 'dark:border-slate-800');
  content = addDark(content, 'border-slate-200', 'dark:border-slate-700');
  content = addDark(content, 'border-slate-300', 'dark:border-slate-600');

  content = addDark(content, 'bg-emerald-50', 'dark:bg-emerald-900/30');
  content = addDark(content, 'hover:bg-emerald-100', 'dark:hover:bg-emerald-800/50');
  content = addDark(content, 'text-emerald-800', 'dark:text-emerald-300');
  content = addDark(content, 'border-emerald-200', 'dark:border-emerald-800/50');

  content = addDark(content, 'bg-red-50', 'dark:bg-red-900/30');
  content = addDark(content, 'hover:bg-red-100', 'dark:hover:bg-red-800/50');
  content = addDark(content, 'text-red-600', 'dark:text-red-400');
  content = addDark(content, 'bg-rose-50', 'dark:bg-rose-900/30');
  content = addDark(content, 'border-rose-200', 'dark:border-rose-800/50');
  
  content = addDark(content, 'bg-amber-50', 'dark:bg-amber-900/30');
  content = addDark(content, 'border-amber-200', 'dark:border-amber-800/50');
  content = addDark(content, 'text-amber-800', 'dark:text-amber-300');
  
  content = addDark(content, 'bg-indigo-50', 'dark:bg-indigo-900/30');
  content = addDark(content, 'border-indigo-200', 'dark:border-indigo-800/50');
  content = addDark(content, 'text-indigo-700', 'dark:text-indigo-300');

  content = addDark(content, 'bg-sky-50', 'dark:bg-sky-900/30');
  content = addDark(content, 'border-sky-200', 'dark:border-sky-800/50');
  content = addDark(content, 'text-sky-700', 'dark:text-sky-300');

  // Input background overrides (inputs without explicit bg color get bg-white and dark:bg-slate-900)
  // We'll target class="... px-4 py-3 border ..." or similar which we know are inputs
  content = content.replace(/<input([^>]*?)class="([^"]*?)"([^>]*?)>/g, (match, p1, classes, p3) => {
    let cls = classes.split(/\s+/);
    if (!cls.includes('bg-transparent') && !cls.includes('bg-white') && !cls.includes('bg-slate-50')) {
      cls.push('bg-white', 'dark:bg-slate-900');
    }
    return `<input${p1}class="${cls.join(' ')}"${p3}>`;
  });
  
  content = content.replace(/<select([^>]*?)class="([^"]*?)"([^>]*?)>/g, (match, p1, classes, p3) => {
    let cls = classes.split(/\s+/);
    if (!cls.includes('bg-transparent') && !cls.includes('bg-white') && !cls.includes('bg-slate-50')) {
      cls.push('bg-white', 'dark:bg-slate-900');
    }
    return `<select${p1}class="${cls.join(' ')}"${p3}>`;
  });

  fs.writeFileSync(filePath, content);
}

processFile('c:/Users/Ball/Desktop/Claude/Badminton/index.html');
processFile('c:/Users/Ball/Desktop/Claude/Badminton/app.js');

console.log('Fixed classes and input fields in both index.html and app.js');
