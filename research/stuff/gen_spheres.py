"""
Generate sphere colour map images for the Principia implementation spec.
Each image renders a unit sphere with a specific colour mapping applied.
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
from mpl_toolkits.mplot3d import Axes3D
import os

OUT = "/home/claude"
DPI = 200
SIZE = (3, 3)  # inches

# ============================================================
# OKLAB colour space utilities
# ============================================================

def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * c**(1/2.4) - 0.055)

def oklab_to_linear_rgb(L, a, b):
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l = l_**3
    m = m_**3
    s = s_**3
    r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    b_out = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return np.stack([r, g, b_out], axis=-1)

def oklab_to_srgb(L, a, b):
    rgb_lin = oklab_to_linear_rgb(L, a, b)
    return linear_to_srgb(np.clip(rgb_lin, 0, 1))

# ============================================================
# Sphere mesh
# ============================================================

def make_sphere(n=200):
    """Return (x,y,z,nx,ny,nz) arrays for a sphere mesh."""
    u = np.linspace(0, 2*np.pi, n)
    v = np.linspace(0, np.pi, n)
    x = np.outer(np.cos(u), np.sin(v))
    y = np.outer(np.sin(u), np.sin(v))
    z = np.outer(np.ones_like(u), np.cos(v))
    return x, y, z

def render_sphere(x, y, z, colors, filename, figsize=SIZE):
    """Render a sphere with given face colours."""
    fig = plt.figure(figsize=figsize)
    ax = fig.add_subplot(111, projection='3d')
    ax.plot_surface(x, y, z, facecolors=colors, rstride=1, cstride=1,
                    antialiased=True, shade=False)
    ax.set_xlim([-1, 1])
    ax.set_ylim([-1, 1])
    ax.set_zlim([-1, 1])
    ax.set_box_aspect([1, 1, 1])
    ax.axis('off')
    ax.view_init(elev=20, azim=45)
    ax.set_facecolor('white')
    fig.patch.set_facecolor('white')
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0)
    fig.savefig(os.path.join(OUT, filename), dpi=DPI, bbox_inches='tight',
                pad_inches=0.02, facecolor='white')
    plt.close(fig)
    print(f"  -> {filename}")

# ============================================================
# vMF colour mapping
# ============================================================

# Pole directions: +x, -x, +y, -y, +z, -z
POLES = np.array([
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1]
], dtype=float)

# Full OKLAB hue angles (degrees)
OKLAB_HUES = np.radians([0, 180, 120, 300, 240, 60])  # R, C, G, M, B, Y

# Okabe-Ito hue angles (degrees)
OI_HUES = np.radians([250, 70, 30, 210, 170, 350])  # B, O, V, SB, BG, RP

def vmf_colour(nx, ny, nz, kappa, hues, L=0.65, C=0.15):
    """VMF 6-pole colour mapping in OKLAB."""
    n = np.stack([nx, ny, nz], axis=-1)  # (..., 3)
    shape = n.shape[:-1]
    
    # Compute weights for each pole
    weights = np.zeros(shape + (6,))
    for i in range(6):
        dot = np.sum(n * POLES[i], axis=-1)
        weights[..., i] = np.exp(kappa * dot)
    
    w_sum = np.sum(weights, axis=-1, keepdims=True)
    weights = weights / (w_sum + 1e-12)
    
    # Weighted mean in OKLAB (a, b) plane
    a_vals = C * np.sum(weights * np.cos(hues), axis=-1)
    b_vals = C * np.sum(weights * np.sin(hues), axis=-1)
    
    L_arr = np.full(shape, L)
    return oklab_to_srgb(L_arr, a_vals, b_vals)

# ============================================================
# Image generators
# ============================================================

def gen_vmf_oklab(x, y, z):
    """Figure 1a: VMF OKLAB, kappa=3"""
    colors = vmf_colour(x, y, z, kappa=3.0, hues=OKLAB_HUES)
    render_sphere(x, y, z, colors, "vmf_oklab.png")

def gen_vmf_okabeito(x, y, z):
    """Figure 1b: VMF Okabe-Ito, kappa=3"""
    colors = vmf_colour(x, y, z, kappa=3.0, hues=OI_HUES)
    render_sphere(x, y, z, colors, "vmf_okabeito.png")

def gen_vmf_oi_lowk(x, y, z):
    """Figure 1c: VMF Okabe-Ito, low kappa (wide blobs)"""
    colors = vmf_colour(x, y, z, kappa=0.8, hues=OI_HUES)
    render_sphere(x, y, z, colors, "vmf_oi_lowk.png")

def gen_vmf_oi_highk(x, y, z):
    """Figure 1d: VMF Okabe-Ito, high kappa (crisp poles)"""
    colors = vmf_colour(x, y, z, kappa=10.0, hues=OI_HUES)
    render_sphere(x, y, z, colors, "vmf_oi_highk.png")

def gen_stab_hue(x, y, z):
    """Figure 2a: Stability x hue mode.
    Hue from vMF, lightness modulated by BC proximity."""
    # Binary collision points (equal mass)
    bc = np.array([
        [1, 0, 0],
        [-0.5, np.sqrt(3)/2, 0],
        [-0.5, -np.sqrt(3)/2, 0]
    ])
    
    n = np.stack([x, y, z], axis=-1)
    
    # Max dot product with any BC point
    max_bc = np.max([np.sum(n * bc[i], axis=-1) for i in range(3)], axis=0)
    
    # Lightness: dark near collisions, light elsewhere
    L = 0.25 + 0.55 * 0.5 * (1 - max_bc)
    
    # Hue from Okabe-Ito VMF
    C = 0.12
    kappa = 3.0
    weights = np.zeros(x.shape + (6,))
    for i in range(6):
        dot = np.sum(n * POLES[i], axis=-1)
        weights[..., i] = np.exp(kappa * dot)
    w_sum = np.sum(weights, axis=-1, keepdims=True)
    weights = weights / (w_sum + 1e-12)
    
    a_vals = C * np.sum(weights * np.cos(OI_HUES), axis=-1)
    b_vals = C * np.sum(weights * np.sin(OI_HUES), axis=-1)
    
    colors = oklab_to_srgb(L, a_vals, b_vals)
    render_sphere(x, y, z, colors, "stab_hue.png")

def gen_dir_cosines(x, y, z):
    """Figure 2b: Direction cosines RGB."""
    r = 0.5 * (x + 1)
    g = 0.5 * (y + 1)
    b = 0.5 * (z + 1)
    colors = np.stack([r, g, b], axis=-1)
    colors = np.clip(colors, 0, 1)
    render_sphere(x, y, z, colors, "dir_cosines.png")

def gen_harmonics(x, y, z):
    """Figure 2c: Spherical harmonic Y_3^3.
    Y_3^3 ~ sin^3(theta) * cos(3*phi) (real part)."""
    theta = np.arccos(np.clip(z, -1, 1))
    phi = np.arctan2(y, x)
    
    # Real part of Y_3^3 (up to normalisation)
    val = np.sin(theta)**3 * np.cos(3 * phi)
    
    # Normalise to [-1, 1]
    vmax = np.max(np.abs(val))
    val_norm = val / (vmax + 1e-12)
    
    # Diverging colourmap
    colors = plt.cm.coolwarm(0.5 * (val_norm + 1))[:, :, :3]
    render_sphere(x, y, z, colors, "harmonics.png")

def gen_physics_overlay(x, y, z):
    """Figure 3: Physics overlay on Okabe-Ito base.
    BC blobs, Euler anti-blobs, Lagrange pole blobs."""
    # Base colour: Okabe-Ito VMF
    base = vmf_colour(x, y, z, kappa=3.0, hues=OI_HUES)
    
    n = np.stack([x, y, z], axis=-1)
    
    # BC points
    bc = np.array([
        [1, 0, 0],
        [-0.5, np.sqrt(3)/2, 0],
        [-0.5, -np.sqrt(3)/2, 0]
    ])
    # Euler points (antipodal to BC on equator)
    euler = -bc
    # Lagrange poles
    lagrange = np.array([[0, 0, 1], [0, 0, -1.0]])
    
    # BC blob colours (warm, distinct)
    bc_cols = np.array([
        [0.8, 0.2, 0.2],  # red
        [0.2, 0.7, 0.2],  # green
        [0.2, 0.2, 0.8],  # blue
    ])
    
    # Overlay BC blobs
    kbc = 11.0
    s = 0.8  # strength
    colors = base.copy()
    for i in range(3):
        dot = np.sum(n * bc[i], axis=-1)
        w = s * 4 * np.maximum(0, np.exp(kbc * (dot - 1) + 0.01))
        for c in range(3):
            colors[..., c] = colors[..., c] * (1 - w) + bc_cols[i, c] * w
    
    # Lagrange pole blobs (white-ish)
    klag = 9.0
    for i in range(2):
        dot = np.sum(n * lagrange[i], axis=-1)
        w = s * 3 * np.maximum(0, np.exp(klag * (dot - 1) + 0.01))
        for c in range(3):
            colors[..., c] = colors[..., c] * (1 - w) + 0.9 * w
    
    colors = np.clip(colors, 0, 1)
    render_sphere(x, y, z, colors, "physics_overlay.png")

def gen_pat_octant(x, y, z):
    """Figure 4a: Octant mode (8 regions by sign)."""
    # Okabe-Ito palette (8 colours)
    palette = np.array([
        [0.00, 0.45, 0.70],  # blue
        [0.90, 0.62, 0.00],  # orange
        [0.00, 0.62, 0.45],  # teal
        [0.80, 0.47, 0.65],  # pink
        [0.94, 0.89, 0.26],  # yellow
        [0.34, 0.71, 0.91],  # sky blue
        [0.84, 0.37, 0.00],  # vermillion
        [0.60, 0.60, 0.60],  # grey
    ])
    
    idx = (np.sign(x) > 0).astype(int) * 4 + \
          (np.sign(y) > 0).astype(int) * 2 + \
          (np.sign(z) > 0).astype(int)
    
    colors = palette[idx]
    render_sphere(x, y, z, colors, "pat_octant.png")

def gen_pat_voronoi6(x, y, z):
    """Figure 4b: Voronoi-6 (nearest axis pole)."""
    palette = np.array([
        [0.00, 0.45, 0.70],  # +x: blue
        [0.90, 0.62, 0.00],  # -x: orange
        [0.84, 0.37, 0.00],  # +y: vermillion
        [0.34, 0.71, 0.91],  # -y: sky blue
        [0.00, 0.62, 0.45],  # +z: teal
        [0.80, 0.47, 0.65],  # -z: pink
    ])
    
    n = np.stack([x, y, z], axis=-1)
    dots = np.stack([np.sum(n * POLES[i], axis=-1) for i in range(6)], axis=-1)
    idx = np.argmax(dots, axis=-1)
    
    colors = palette[idx]
    render_sphere(x, y, z, colors, "pat_voronoi6.png")

def gen_pat_checker(x, y, z):
    """Figure 4c: Checkerboard (f=4, seam-free)."""
    f = 4
    theta = np.arccos(np.clip(z, -1, 1))
    phi = np.arctan2(y, x)
    
    even = (np.floor(f * theta / np.pi).astype(int) + 
            np.floor(f * phi / (2 * np.pi)).astype(int)) % 2
    
    # Two-tone Okabe-Ito
    c0 = np.array([0.00, 0.45, 0.70])  # blue
    c1 = np.array([0.90, 0.62, 0.00])  # orange
    
    colors = np.where(even[..., None] == 0, c0, c1)
    render_sphere(x, y, z, colors, "pat_checker.png")

# ============================================================
# Main
# ============================================================

if __name__ == "__main__":
    print("Generating sphere images...")
    x, y, z = make_sphere(250)
    
    print("Figure 1: VMF colour maps")
    gen_vmf_oklab(x, y, z)
    gen_vmf_okabeito(x, y, z)
    gen_vmf_oi_lowk(x, y, z)
    gen_vmf_oi_highk(x, y, z)
    
    print("Figure 2: Special colour modes")
    gen_stab_hue(x, y, z)
    gen_dir_cosines(x, y, z)
    gen_harmonics(x, y, z)
    
    print("Figure 3: Physics overlay")
    gen_physics_overlay(x, y, z)
    
    print("Figure 4: Pattern modes")
    gen_pat_octant(x, y, z)
    gen_pat_voronoi6(x, y, z)
    gen_pat_checker(x, y, z)
    
    print("Done. All images in", OUT)
