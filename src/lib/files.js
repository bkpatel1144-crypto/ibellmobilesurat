// ID proofs are stored as compressed data URLs in the "attachments" collection, so the
// app runs on Firebase's free Spark plan (no Cloud Storage bucket needed).
// A Firestore document is capped at 1 MiB; we keep each file well under that.

const MAX_BYTES = 850 * 1024;

export async function fileToAttachment(file) {
  if (file.type === 'application/pdf') {
    const dataUrl = await readAsDataUrl(file);
    if (dataUrl.length > MAX_BYTES) {
      throw new Error(`"${file.name}" is too large. PDFs must be under 600 KB - take a photo instead.`);
    }
    return { name: file.name, type: file.type, dataUrl };
  }
  if (!file.type.startsWith('image/')) {
    throw new Error(`"${file.name}" is not an image or PDF.`);
  }
  let dataUrl = await compressImage(file, 1400, 0.72);
  if (dataUrl.length > MAX_BYTES) dataUrl = await compressImage(file, 1000, 0.6);
  if (dataUrl.length > MAX_BYTES) dataUrl = await compressImage(file, 800, 0.5);
  return { name: file.name, type: 'image/jpeg', dataUrl };
}

/** Logo: small square-ish image, PNG kept for transparency */
export async function fileToLogo(file) {
  if (!file.type.startsWith('image/')) throw new Error('Logo must be an image.');
  const img = await loadImage(await readAsDataUrl(file));
  const scale = Math.min(1, 400 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = src;
  });
}

async function compressImage(file, maxSide, quality) {
  const img = await loadImage(await readAsDataUrl(file));
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
