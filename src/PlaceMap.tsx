// A small static map preview for one place, so the rename dialog can answer "which
// spot is this?" before asking for a name.
//
// Plain <img> tiles from OpenStreetMap — no map library, no API key, no billing, and
// nothing that runs JavaScript from a third party. A 3x3 mosaic is translated so the
// place's exact coordinate sits at the centre of the frame, under the pin.

const TILE = 256
const ZOOM = 17
const RADIUS = 1 // tiles either side of centre -> a 3x3 mosaic

// Web Mercator: longitude is linear, latitude runs through the Mercator projection.
// Fractional, because the place is almost never on a tile boundary.
function tileCoords(latitude: number, longitude: number, zoom: number) {
  const n = 2 ** zoom
  const lat = (Math.max(-85.05, Math.min(85.05, latitude)) * Math.PI) / 180
  return {
    x: ((longitude + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n,
  }
}

export default function PlaceMap({ latitude, longitude, label }: { latitude: number; longitude: number; label?: string }) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const { x, y } = tileCoords(latitude, longitude, ZOOM)
  const originX = Math.floor(x) - RADIUS
  const originY = Math.floor(y) - RADIUS
  const span = RADIUS * 2 + 1
  // Where the coordinate falls inside the mosaic, in pixels from its top-left.
  const pinX = (x - originX) * TILE
  const pinY = (y - originY) * TILE
  const max = 2 ** ZOOM

  const tiles = []
  for (let row = 0; row < span; row += 1) {
    for (let column = 0; column < span; column += 1) {
      const tx = ((originX + column) % max + max) % max // longitude wraps at the date line
      const ty = originY + row
      // Above the pole or below it there is no tile; leave the cell blank.
      const src = ty < 0 || ty >= max ? null : `https://tile.openstreetmap.org/${ZOOM}/${tx}/${ty}.png`
      tiles.push(
        src
          // Not lazy: the mosaic is translated inside a clipped frame, so most tiles
          // are technically out of view and a lazy loader never fetches them. Nine
          // small tiles, only rendered while the dialog is open.
          ? <img key={`${tx}-${ty}`} src={src} alt="" width={TILE} height={TILE} draggable={false} />
          : <span key={`blank-${row}-${column}`} className="pm-blank" />,
      )
    }
  }

  return (
    <div className="place-map">
      <div className="pm-frame">
        {/* Anchored at the frame's centre, then pulled back by the pin's offset inside
            the mosaic, which lands the exact coordinate under the pin at any frame size. */}
        <div className="pm-mosaic" style={{ transform: `translate(${-pinX}px, ${-pinY}px)`, gridTemplateColumns: `repeat(${span}, ${TILE}px)` }}>
          {tiles}
        </div>
        <span className="pm-pin" role="img" aria-label={label ? `Map showing ${label}` : 'Map showing this place'} />
      </div>
      <p className="pm-credit">
        Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">OpenStreetMap</a> contributors
      </p>
    </div>
  )
}
