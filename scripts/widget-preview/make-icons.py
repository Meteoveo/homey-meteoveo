#!/usr/bin/env python3
"""The app's SVG icons as FILLED outlines.

Homey renders icons as a single-colour mask, so strokes vanish and an outline
circle floods the tile (seen on the owner's phone, 2026-10-23). Every icon is
therefore line art turned into geometry: each stroke is buffered to a filled
shape, rings and outlines are differences, everything is unioned, and the
result is one path per icon with fill-rule evenodd - no strokes, gradients,
masks or clip-paths. Canvas 960 x 960 (Athom's), generous padding, drawn to
read at 24-32 px.

    python3 scripts/widget-preview/make-icons.py
"""
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

REPO = Path(__file__).resolve().parents[2]
CANVAS = 960
W = 68           # the line width of the app and driver icons
WC = 76          # the capability icons are shown smaller still: a touch bolder
Q = 1            # coordinate rounding in the output (canvas units)


def stroke(points, width=W, closed=False):
    line = LineString(points + ([points[0]] if closed else []))
    return line.buffer(width / 2, cap_style="round", join_style="round")


def ring(cx, cy, r, width=W):
    return Point(cx, cy).buffer(r + width / 2, 128).difference(Point(cx, cy).buffer(r - width / 2, 128))


def disc(cx, cy, r):
    return Point(cx, cy).buffer(r, 128)


def cloud_solid(cx, cy, s=1.0):
    """The brand cloud's silhouette (the simple logo: three discs on a bar), centred at cx, cy; s scales it."""
    parts = [
        disc(cx - 62 * s, cy + 18 * s, 56 * s),
        disc(cx + 74 * s, cy + 12 * s, 60 * s),
        disc(cx + 4 * s, cy - 18 * s, 80 * s),
        box(cx - 118 * s, cy + 16 * s, cx + 134 * s, cy + 74 * s).buffer(0),
    ]
    poly = unary_union(parts)
    # The bar's corners rounded like the logo's rx.
    return poly.buffer(16 * s).buffer(-16 * s)


def outline(poly, width=W):
    return poly.buffer(width / 2).difference(poly.buffer(-width / 2))


def sun(cx, cy, r, rays, gap, ray_len, width=W, angles=range(0, 360, 45)):
    import math
    parts = [ring(cx, cy, r, width)]
    for a in angles:
        t = math.radians(a)
        x0, y0 = cx + math.cos(t) * (r + gap), cy + math.sin(t) * (r + gap)
        x1, y1 = cx + math.cos(t) * (r + gap + ray_len), cy + math.sin(t) * (r + gap + ray_len)
        parts.append(stroke([(x0, y0), (x1, y1)], width))
    return unary_union(parts)


def pin(cx, cy, r, width=W):
    """A map pin: a disc head with a hole, tapering to a point below."""
    import math
    head = disc(cx, cy, r)
    tip_y = cy + r * 2.15
    # Tangent points of the tip on the head circle.
    d = tip_y - cy
    ang = math.acos(r / d)
    px1 = cx - r * math.sin(ang); py1 = cy + r * math.cos(ang)
    px2 = cx + r * math.sin(ang); py2 = cy + r * math.cos(ang)
    body = unary_union([head, Polygon([(px1, py1), (cx, tip_y), (px2, py2)])]).buffer(1).buffer(-1)
    shape = outline(body, width)
    shape = shape.union(disc(cx, cy, r * 0.36))
    return shape


def to_path(geom):
    polys = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
    cmds = []
    for p in polys:
        for ringc in [p.exterior, *p.interiors]:
            pts = [f"{round(x, Q):g} {round(y, Q):g}" for x, y in ringc.coords[:-1]]
            cmds.append("M" + "L".join(pts) + "Z")
    return "".join(cmds)


def svg(geom, size=CANVAS):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">'
            f'<path d="{to_path(geom)}" fill="#000" fill-rule="evenodd"/></svg>\n')


def simplify(geom, tol=0.6):
    return geom.simplify(tol, preserve_topology=True)


# ---- The icons ---------------------------------------------------------------

def app_icon():
    """The brand mark as line art: the sky disc, the cloud inside, the ground as a chord."""
    c = CANVAS / 2
    R = 400
    parts = [ring(c, c, R)]
    parts.append(outline(cloud_solid(c - 8, c + 10, 1.5)))
    # The ground: a chord inside the disc, below the cloud, with its ends inset from the ring.
    y = c + R * 0.66
    half = (R ** 2 - (y - c) ** 2) ** 0.5 - W * 1.2
    parts.append(stroke([(c - half, y), (c + half, y)]))
    return unary_union(parts)


def driver_icon():
    """Weather at my place: the brand cloud with a map pin hanging below it."""
    c = CANVAS / 2
    parts = [outline(cloud_solid(c, 340, 1.4))]
    parts.append(pin(c, 630, 98))
    return unary_union(parts)


def cap_condition():
    """Sun behind the cloud (the sky's state)."""
    s = sun(620, 300, 120, 8, 54, 70, WC)
    cl = cloud_solid(430, 580, 1.2)
    # The cloud in front: cut the sun where the cloud is (plus a gap), then add the cloud outline.
    s = s.difference(cl.buffer(WC * 1.3))
    return unary_union([s, outline(cl, WC)])


def cap_rain():
    cl = cloud_solid(480, 370, 1.25)
    drops = [stroke([(x, 680), (x - 44, 790)], WC) for x in (380, 530, 680)]
    return unary_union([outline(cl, WC), *drops])


def cap_clock():
    c = CANVAS / 2
    parts = [ring(c, c, 330, WC), stroke([(c, c - 190), (c, c), (c + 150, c + 86)], WC)]
    return unary_union(parts)


def cap_warning():
    tri = Polygon([(480, 120), (870, 800), (90, 800)]).buffer(40).buffer(-40)  # rounded corners
    parts = [outline(tri, WC), stroke([(480, 330), (480, 560)], WC + 8), disc(480, 680, (WC + 8) / 2)]
    return unary_union(parts)


ICONS = {
    REPO / "assets" / "icon.svg": app_icon,
    REPO / "drivers" / "meteoveo" / "assets" / "icon.svg": driver_icon,
    REPO / "assets" / "capabilities" / "condition.svg": cap_condition,
    REPO / "assets" / "capabilities" / "rain.svg": cap_rain,
    REPO / "assets" / "capabilities" / "clock.svg": cap_clock,
    REPO / "assets" / "capabilities" / "warning.svg": cap_warning,
}

if __name__ == "__main__":
    for path, fn in ICONS.items():
        geom = simplify(fn())
        minx, miny, maxx, maxy = geom.bounds
        text = svg(geom)
        path.write_text(text)
        print(f"{path.relative_to(REPO)}  bounds {minx:.0f},{miny:.0f} - {maxx:.0f},{maxy:.0f}  {len(text)} bytes")
