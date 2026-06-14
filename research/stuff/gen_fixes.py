"""
Fixed factorisation, fixed alpha sphere, new manifold projections diagram.
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Ellipse, Polygon
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import os

OUT = "/home/claude"
DPI = 200

def _box(ax, x, y, w, h, text, color='#e8e8e8', edgecolor='#333',
         fontsize=9, bold=False, textcolor='#111'):
    box = FancyBboxPatch((x - w/2, y - h/2), w, h,
                         boxstyle="round,pad=0.08", facecolor=color,
                         edgecolor=edgecolor, linewidth=1.5)
    ax.add_patch(box)
    weight = 'bold' if bold else 'normal'
    ax.text(x, y, text, ha='center', va='center', fontsize=fontsize,
            fontweight=weight, color=textcolor)


# ============================================================
# 1. FIXED FACTORISATION
# ============================================================
def gen_factorisation():
    fig, ax = plt.subplots(1, 1, figsize=(11, 4.5))
    ax.set_xlim(-0.3, 11.3)
    ax.set_ylim(-1, 4.5)
    ax.axis('off')
    ax.set_title(r'IC Manifold Factorisation: $Y \cong Y_{mass} \times Y_{cfg} \times Y_{mom}$',
                 fontsize=12, fontweight='bold', pad=12)

    # Three subspaces - more spaced out
    x_positions = [1.5, 4.5, 7.5]
    labels = [r'$Y_{mass}$', r'$Y_{cfg}$', r'$Y_{mom}$']
    dofs = ['2 DOF', '3 DOF', '4 DOF']
    colors = ['#cc4444', '#2266aa', '#228833']
    
    descs = [
        r'softmax$(0, \mu_1, \mu_2)$' + '\n' + r'$\to (m_1, m_2, m_3)$' + '\n' + r'$\sum m_i = 1$',
        'Hyperspherical Jacobi\n' + r'$(\alpha, \beta) \to (\tilde{\rho}, \tilde{\lambda})$' + '\n' + r'$I = 1$ (scale gauge)',
        'Free momenta or\n' + r'$(L_z, K)$ invariant' + '\n' + r'$\sum p_i = 0$ (COM)',
    ]

    for x, label, dof, color, desc in zip(x_positions, labels, dofs, colors, descs):
        # Main box
        _box(ax, x, 2.8, 2.2, 1.0, label + '\n' + dof, 
             color + '18', edgecolor=color, fontsize=10, bold=True, textcolor=color)
        # Description below
        ax.text(x, 1.6, desc, ha='center', va='top', fontsize=7.5,
                color='#444', linespacing=1.3)

    # × symbols between boxes
    ax.text(3.0, 2.8, r'$\times$', fontsize=20, ha='center', va='center',
            color='#888', fontweight='bold')
    ax.text(6.0, 2.8, r'$\times$', fontsize=20, ha='center', va='center',
            color='#888', fontweight='bold')

    # Arrow to assembled IC
    ax.annotate('', xy=(9.8, 2.8), xytext=(8.7, 2.8),
                arrowprops=dict(arrowstyle='->', color='#555', lw=2.5))
    ax.text(9.25, 3.15, 'join', fontsize=8, ha='center', color='#666', style='italic')

    # Output box - now properly inside canvas
    _box(ax, 10.5, 2.8, 1.2, 0.9, r'$(m_i, r_i, p_i)$',
         '#f0e6ff', edgecolor='#7744aa', fontsize=9, bold=True, textcolor='#7744aa')

    # DOF counting
    ax.text(5.5, 0.0, 'Total: 2 + 3 + 4 = 9 internal DOF  '
            '(10 latent coordinates, 1 redundant for interpolation flexibility)',
            ha='center', fontsize=8, color='#555',
            bbox=dict(boxstyle='round,pad=0.3', facecolor='#f8f8f8', edgecolor='#ddd'))

    fig.savefig(os.path.join(OUT, 'factorisation.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.15)
    plt.close(fig)
    print("  -> factorisation.png")


# ============================================================
# 2. FIXED ALPHA SPHERE
# ============================================================
def gen_alpha_sphere():
    fig = plt.figure(figsize=(10, 5))

    # Left: 3D sphere coloured by alpha
    ax = fig.add_subplot(121, projection='3d')

    n_pts = 250
    u = np.linspace(0, 2*np.pi, n_pts)
    v = np.linspace(0, np.pi, n_pts)
    x = np.outer(np.cos(u), np.sin(v))
    y = np.outer(np.sin(u), np.sin(v))
    z = np.outer(np.ones_like(u), np.cos(v))

    # alpha ~ arccos(nz)/2 on the shape sphere
    alpha_vals = np.arccos(np.clip(z, -1, 1)) / 2
    alpha_norm = alpha_vals / (np.pi / 2)

    cmap = plt.cm.RdYlBu_r
    colors = cmap(alpha_norm)

    ax.plot_surface(x, y, z, facecolors=colors, rstride=1, cstride=1,
                    antialiased=True, shade=False)

    # Key points
    ax.scatter(0, 0, 1, s=80, c='#cc4444', zorder=10, edgecolors='darkred', lw=1)
    ax.text(0.15, 0.15, 1.15, '$\\alpha \\approx 0$\ntight pair', fontsize=7,
            ha='center', color='darkred', fontweight='bold')

    ax.scatter(0, 0, -1, s=80, c='#2266aa', zorder=10, edgecolors='#113355', lw=1)
    ax.text(0.15, 0.15, -1.25, '$\\alpha \\approx \\pi/2$\ncomparable', fontsize=7,
            ha='center', va='top', color='#113355', fontweight='bold')

    # Equator
    theta_eq = np.linspace(0, 2*np.pi, 100)
    ax.plot(np.cos(theta_eq), np.sin(theta_eq), np.zeros_like(theta_eq),
            '-', color='white', lw=1.5, alpha=0.8)

    ax.set_xlim([-1.3, 1.3])
    ax.set_ylim([-1.3, 1.3])
    ax.set_zlim([-1.3, 1.3])
    ax.set_box_aspect([1, 1, 1])
    ax.axis('off')
    ax.view_init(elev=20, azim=40)
    ax.set_title('Shape sphere $S^2$\ncoloured by $\\alpha$', fontsize=10, fontweight='bold')

    # Right: example triangles - use a regular axes (not subplot)
    ax2 = fig.add_subplot(122)
    ax2.set_xlim(-0.3, 4.8)
    ax2.set_ylim(-1.0, 3.8)
    ax2.set_aspect('equal')
    ax2.axis('off')
    ax2.set_title('Triangle shapes at different $\\alpha$', fontsize=10, fontweight='bold')

    alphas = [0.1, 0.35, 0.6, 0.85, 1.1, 1.35]
    beta_fixed = 0.85
    cmap_tri = plt.cm.RdYlBu_r

    cols = 3
    for i, alpha in enumerate(alphas):
        col = i % cols
        row = i // cols
        x0 = col * 1.6 + 0.3
        y0 = (1 - row) * 1.8 + 0.5

        rho_m = np.cos(alpha)
        lam_m = np.sin(alpha)
        scale = 0.55

        p1 = np.array([x0, y0])
        p2 = np.array([x0 + rho_m * scale, y0])
        lam_vec = lam_m * scale * np.array([np.cos(beta_fixed), np.sin(beta_fixed)])
        com12 = (p1 + p2) / 2
        p3 = com12 + lam_vec

        pts = np.array([p1, p2, p3])
        tri = np.vstack([pts, pts[0]])

        c = cmap_tri(alpha / (np.pi/2))
        ax2.plot(tri[:, 0], tri[:, 1], '-', color='#444', lw=1.2)
        ax2.fill(pts[:, 0], pts[:, 1], alpha=0.25, color=c)

        for j in range(3):
            ax2.plot(pts[j, 0], pts[j, 1], 'o', markersize=[6, 5, 4][j],
                    color=['#cc4444', '#2266aa', '#228833'][j],
                    markeredgecolor='#333', lw=0.5, zorder=10)

        ax2.text(x0 + rho_m * scale / 2, y0 - 0.35,
                 f'$\\alpha = {alpha:.2f}$', fontsize=7, ha='center',
                 fontweight='bold', color='#333',
                 bbox=dict(boxstyle='round,pad=0.1', facecolor=c, alpha=0.25,
                          edgecolor='none'))

    # Arrow and labels
    ax2.annotate('', xy=(4.3, -0.5), xytext=(0.5, -0.5),
                arrowprops=dict(arrowstyle='->', color='#888', lw=1.5))
    ax2.text(0.7, -0.8, 'Tight inner pair\n(hierarchical)',
             fontsize=7.5, ha='center', color='#cc4444', fontweight='bold')
    ax2.text(4.1, -0.8, 'Comparable scales\n(compact)',
             fontsize=7.5, ha='center', color='#2266aa', fontweight='bold')

    fig.tight_layout(w_pad=2)
    fig.savefig(os.path.join(OUT, 'alpha_sphere.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.15)
    plt.close(fig)
    print("  -> alpha_sphere.png")


# ============================================================
# 3. MANIFOLD PROJECTIONS / WEDGE SHAPES
# ============================================================
def gen_manifold_projections():
    fig = plt.figure(figsize=(10, 6))
    
    # Main 3D view showing the manifold and different slice orientations
    ax = fig.add_subplot(111, projection='3d')
    ax.set_title('IC Manifold: Charts as Different Projections\nof a High-Dimensional Space',
                 fontsize=11, fontweight='bold', pad=5)
    
    # Draw a translucent ellipsoid representing the manifold
    u = np.linspace(0, 2*np.pi, 50)
    v = np.linspace(0, np.pi, 30)
    ex = 1.5 * np.outer(np.cos(u), np.sin(v))
    ey = 1.2 * np.outer(np.sin(u), np.sin(v))
    ez = 1.0 * np.outer(np.ones_like(u), np.cos(v))
    ax.plot_surface(ex, ey, ez, alpha=0.05, color='#888',
                    edgecolor='#ccc', linewidth=0.15)
    
    # Slice 1: Horizontal plane (affine slice in z3-z4)
    s = np.linspace(-1.2, 1.2, 8)
    S1, S2 = np.meshgrid(s, s)
    Z_plane = np.zeros_like(S1)
    ax.plot_surface(S1, S2, Z_plane, alpha=0.2, color='#cc4444',
                    edgecolor='#cc4444', linewidth=0.3)
    # Label
    ax.text(1.4, 1.4, 0.1, 'Affine slice\n$(z_3, z_4)$', fontsize=7,
            color='#cc4444', fontweight='bold')
    
    # Slice 2: Tilted plane (tilted into z5)
    tilt = 0.5
    Z_tilted = S2 * np.sin(tilt) * 0.6
    Y_tilted = S2 * np.cos(tilt)
    ax.plot_surface(S1, Y_tilted, Z_tilted, alpha=0.2, color='#2266aa',
                    edgecolor='#2266aa', linewidth=0.3)
    ax.text(1.4, 0.5, 0.8, 'Tilted slice\n$(z_3, z_5)$', fontsize=7,
            color='#2266aa', fontweight='bold')
    
    # Slice 3: Vertical plane (invariant chart Lz-E)
    Z_vert = S2
    Y_vert = np.zeros_like(S1)
    ax.plot_surface(S1, Y_vert, Z_vert, alpha=0.2, color='#228833',
                    edgecolor='#228833', linewidth=0.3)
    ax.text(1.4, -0.1, 1.0, '$(L_z, E)$\ninvariant', fontsize=7,
            color='#228833', fontweight='bold')
    
    # Wedge: the Burrau family as a 1D curve through the manifold
    t_curve = np.linspace(0, 2*np.pi, 100)
    cx = 0.8 * np.cos(t_curve * 0.5) * np.sin(t_curve)
    cy = 0.6 * np.sin(t_curve * 0.7)
    cz = 0.4 * np.cos(t_curve)
    ax.plot(cx, cy, cz, '-', color='#cc8800', lw=2.5, zorder=10)
    ax.text(0.5, 0.7, 0.5, 'Burrau\nfamily\n(1D curve)', fontsize=7,
            color='#cc8800', fontweight='bold')
    
    # Lock point at intersection
    ax.scatter(0, 0, 0, s=100, c='red', zorder=15, edgecolors='darkred', lw=1.5)
    ax.text(0.15, 0.15, -0.25, '$z_0$\n(lock)', fontsize=7,
            color='darkred', fontweight='bold')
    
    # Curved surface: shape sphere as a 2D submanifold
    theta_ss = np.linspace(0, np.pi, 20)
    phi_ss = np.linspace(0, 2*np.pi, 30)
    T, P = np.meshgrid(theta_ss, phi_ss)
    r_ss = 0.5
    offset = np.array([-0.6, -0.4, -0.3])
    xs = r_ss * np.sin(T) * np.cos(P) + offset[0]
    ys = r_ss * np.sin(T) * np.sin(P) + offset[1]
    zs = r_ss * np.cos(T) + offset[2]
    ax.plot_surface(xs, ys, zs, alpha=0.15, color='#9944cc',
                    edgecolor='#9944cc', linewidth=0.2)
    ax.text(-0.6, -0.4, -1.0, 'Shape sphere\n$S^2 \\subset \\mathcal{M}$', fontsize=7,
            color='#9944cc', fontweight='bold', ha='center')
    
    # Axis labels (abstract dimensions)
    ax.text(1.8, 0, 0, '$z_3$', fontsize=8, color='#888')
    ax.text(0, 1.5, 0, '$z_4$', fontsize=8, color='#888')
    ax.text(0, 0, 1.3, '$z_5$', fontsize=8, color='#888')
    
    # Annotation box
    ax.text2D(0.02, 0.05,
              'Each chart projects $\\mathcal{M}$ onto a different 2D cross-section.\n'
              'The lock point $z_0$ is shared. Tilt continuously rotates\n'
              'between projections. The Burrau family is a 1D curve\n'
              'that different charts intersect at different angles.',
              fontsize=7, transform=ax.transAxes, color='#555',
              bbox=dict(boxstyle='round,pad=0.3', facecolor='white',
                       edgecolor='#ccc', alpha=0.9))
    
    ax.set_xlim([-1.8, 1.8])
    ax.set_ylim([-1.8, 1.8])
    ax.set_zlim([-1.5, 1.5])
    ax.set_box_aspect([1, 1, 0.8])
    ax.axis('off')
    ax.view_init(elev=25, azim=35)

    fig.savefig(os.path.join(OUT, 'manifold_projections.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.12)
    plt.close(fig)
    print("  -> manifold_projections.png")


# ============================================================
if __name__ == "__main__":
    print("Generating fixes + manifold projections...")
    gen_factorisation()
    gen_alpha_sphere()
    gen_manifold_projections()
    print("Done.")
