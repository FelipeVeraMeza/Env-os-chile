// Marca al instante (pedido 13-10): antes de que cargue la app se veían textos de relleno ("Tu Empresa de Envíos",
// "Modo demo") y parecía un borrador. El nombre y el logo de la última visita quedan guardados en el dispositivo y se
// muestran de inmediato; app.js los actualiza al cargar. Archivo aparte: la política de seguridad no permite scripts
// dentro del HTML.
(function () {
  try {
    var marca = JSON.parse(localStorage.getItem('envios.marca') || 'null');
    if (!marca || !marca.nombre) return;
    document.getElementById('marca-nombre').textContent = marca.nombre;
    document.title = marca.nombre + ' · Envíos';
    if (marca.logo) {
      document.querySelector('.marca img').src = marca.logo;
      var logoCarga = document.getElementById('logo-carga');
      if (logoCarga) { logoCarga.src = marca.logo; logoCarga.hidden = false; }
    }
    document.body.classList.add('marca-lista');
  } catch (e) { /* sin almacenamiento: se muestra la pantalla de carga sin marca */ }
})();
