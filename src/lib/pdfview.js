// In-app PDF preview (loaded only when a preview opens). The legacy build also runs on older phone browsers;
// phones have no built-in PDF viewer inside a page, so pages are drawn to canvases.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Draws the pages of `file` into `box`, `width` CSS pixels wide, each page showing as soon as it is ready.
 * `token.cancelled = true` stops it (preview closed or resized); onFirst() runs when page 1 is on screen.
 */
export async function renderPdf(file, box, width, token = {}, onFirst = () => {}) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
    for (let n = 1; n <= pdf.numPages; n += 1) {
      if (token.cancelled) return;
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page';
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${width}px`;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Page ${n} of ${pdf.numPages}`);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      if (token.cancelled) return;
      if (n === 1) {
        box.replaceChildren(canvas); // swap out the previous size in one go
        onFirst();
      } else box.appendChild(canvas);
    }
  } finally {
    pdf.destroy();
  }
}
