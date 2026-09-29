import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitarPeticiones, validarClave } from '../../server/lib/seguridad.js';

test('política de contraseñas: largo, letras y números, comunes, correo y nombre', () => {
  assert.equal(validarClave('Envio.Seguro.2026'), null);
  assert.match(validarClave('corta1'), /8/);
  assert.match(validarClave('solamenteletras'), /letras y números/);
  assert.match(validarClave('1234567890'), /letras y números/);
  assert.match(validarClave('Password1'), /común/);
  assert.match(validarClave('Demo.2026'), /común/, 'la clave demo pública no se puede reutilizar');
  assert.match(validarClave('camila2026x', { correo: 'camila@correo.cl' }), /correo/);
  assert.match(validarClave('Rojas.2026!', { nombre: 'Camila Rojas' }), /nombre/);
  assert.match(validarClave('a1'.repeat(40)), /72/);
});

test('límite de peticiones: responde 429 con Retry-After al superar el máximo por minuto', () => {
  const limitar = limitarPeticiones(`prueba-${Math.random()}`, 3);
  const req = { ip: '203.0.113.9', method: 'GET', originalUrl: '/api/x', get: () => '' };
  const respuestas = [];
  for (let i = 0; i < 5; i++) {
    const res = { cabeceras: {}, set(k, v) { this.cabeceras[k] = v; }, status(c) { this.codigo = c; return this; }, json() { respuestas.push(this); } };
    limitar(req, res, () => respuestas.push({ codigo: 200 }));
  }
  assert.deepEqual(respuestas.map((r) => r.codigo), [200, 200, 200, 429, 429]);
  assert.ok(Number(respuestas[3].cabeceras['Retry-After']) > 0);
  // Otra IP no se ve afectada.
  let paso = false;
  limitar({ ...req, ip: '203.0.113.10' }, {}, () => { paso = true; });
  assert.ok(paso);
});
