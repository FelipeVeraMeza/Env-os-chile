// Elimina metadatos EXIF (incluida la ubicación GPS) de un JPEG quitando los segmentos APP1.
// Para otros formatos devuelve el buffer sin cambios (el cliente ya re-codifica en canvas).
export function quitarExif(buffer) {
  if (!buffer || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return buffer;
  const partes = [buffer.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buffer.length) {
    if (buffer[i] !== 0xff) break;
    const marcador = buffer[i + 1];
    if (marcador === 0xda) {
      // Inicio de datos de imagen: copiar el resto tal cual.
      partes.push(buffer.subarray(i));
      return Buffer.concat(partes);
    }
    const largo = buffer.readUInt16BE(i + 2);
    const segmento = buffer.subarray(i, i + 2 + largo);
    if (marcador !== 0xe1) partes.push(segmento); // APP1 = EXIF / XMP
    i += 2 + largo;
  }
  partes.push(buffer.subarray(i));
  return Buffer.concat(partes);
}

export function tieneExif(buffer) {
  if (!buffer || buffer[0] !== 0xff || buffer[1] !== 0xd8) return false;
  let i = 2;
  while (i + 4 <= buffer.length && buffer[i] === 0xff) {
    const marcador = buffer[i + 1];
    if (marcador === 0xda) return false;
    if (marcador === 0xe1) return true;
    i += 2 + buffer.readUInt16BE(i + 2);
  }
  return false;
}
