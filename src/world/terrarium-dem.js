/**
 * AWS Terrarium RGB DEM elevation tile helpers and bilinear heightfield sampler.
 */

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Convert WGS84 latitude/longitude to Web Mercator slippy-map tile coordinates.
 * @param {number} lat
 * @param {number} lon
 * @param {number} zoom
 * @returns {{ tx: number, ty: number, fx: number, fy: number, zoom: number }}
 */
export function latLonToTileXY(lat, lon, zoom) {
  const n = 2 ** zoom;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = clampedLat * DEG_TO_RAD;

  const xf = ((lon + 180) / 360) * n;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  const tx = Math.max(0, Math.min(n - 1, Math.floor(xf)));
  const ty = Math.max(0, Math.min(n - 1, Math.floor(yf)));

  return {
    tx,
    ty,
    fx: xf - tx,
    fy: yf - ty,
    zoom,
  };
}

/**
 * Compute geographic lat/lon bounds of a Web Mercator tile.
 * @param {number} tx
 * @param {number} ty
 * @param {number} zoom
 * @returns {{ north: number, south: number, west: number, east: number }}
 */
export function tileXYToBounds(tx, ty, zoom) {
  const n = 2 ** zoom;
  const west = (tx / n) * 360 - 180;
  const east = ((tx + 1) / n) * 360 - 180;
  const north = Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * RAD_TO_DEG;
  const south = Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + 1)) / n))) * RAD_TO_DEG;
  return { north, south, west, east };
}

/**
 * Return the public CORS-enabled AWS Terrarium DEM PNG tile URL.
 * @param {number} tx
 * @param {number} ty
 * @param {number} zoom
 * @returns {string}
 */
export function getTerrariumTileUrl(tx, ty, zoom) {
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`;
}

/**
 * Decode Mapzen/AWS Terrarium RGB pixel values into elevation in meters.
 * Formula: (R * 256 + G + B / 256) - 32768
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number} Elevation in meters
 */
export function decodeTerrariumRgb(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Bilinearly sample a heightfield at normalized `(u, v)` coordinates in `[0, 1]`.
 * Accepts either `{ width, height, data }` (flat array/TypedArray) or a 2D `number[][]`.
 *
 * @param {{ width: number, height: number, data: ArrayLike<number> } | number[][]} grid
 * @param {number} u
 * @param {number} v
 * @returns {number}
 */
export function sampleHeightfieldBilinear(grid, u, v) {
  let width;
  let height;
  let read;

  if (Array.isArray(grid)) {
    height = grid.length;
    width = height > 0 ? grid[0].length : 0;
    read = (x, y) => grid[y][x];
  } else {
    width = grid.width;
    height = grid.height;
    read = (x, y) => grid.data[y * width + x];
  }

  if (width === 0 || height === 0) {
    return 0;
  }

  const cu = Math.max(0, Math.min(1, u));
  const cv = Math.max(0, Math.min(1, v));
  const gx = cu * (width - 1);
  const gy = cv * (height - 1);

  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = gx - x0;
  const ty = gy - y0;

  const h00 = read(x0, y0);
  const h10 = read(x1, y0);
  const h01 = read(x0, y1);
  const h11 = read(x1, y1);

  const top = h00 + (h10 - h00) * tx;
  const bottom = h01 + (h11 - h01) * tx;
  return top + (bottom - top) * ty;
}
