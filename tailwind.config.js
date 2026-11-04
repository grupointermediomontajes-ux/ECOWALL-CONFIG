/** Tailwind se compila a CSS estático (src/css/tailwind.css) en lugar de generarse en la app al arrancar. */
module.exports = {
  content: ['./src/index.html', './src/js/**/*.js'],
  theme: { extend: {} },
  plugins: []
};
