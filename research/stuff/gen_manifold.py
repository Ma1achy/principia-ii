"""
Manifold navigation diagrams and improved Jacobi sphere for Principia spec.
1. Chart atlas concept
2. Slice rotation / tilt
3. Factorisation diagram (mass × config × momentum)
4. Injectivity / seams / no-holes
5. Shape sphere coloured by α with example triangles
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Ellipse, FancyArrowPatch, Polygon, Circle
from matplotlib.collections import LineCollection
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
# 1. CHART ATLAS CONCEPT
# ============================================================
def gen_chart_atlas():
    fig, ax = plt.subplots(1, 1, figsize=(9, 5))
    ax.set_xlim(-1, 9)
    ax.set_ylim(-1, 5.5)
    ax.axis('off')
    ax.set_title('Chart Atlas: Multiple Views of the 10D IC Manifold',
                 fontsize=12, fontweight='bold', pad=12)

    # The manifold (abstract blob)
    theta = np.linspace(0, 2*np.pi, 100)
    r = 1.5 + 0.3*np.sin(3*theta) + 0.15*np.cos(5*theta)
    mx, my = 1.8, 2.8
    ax.fill(mx + r*np.cos(theta), my + r*np.sin(theta),
            alpha=0.08, color='#333', edgecolor='#666', lw=2)
    ax.text(mx, my, '10D IC\nManifold\n$\\mathcal{M}$', ha='center', va='center',
            fontsize=11, fontweight='bold', color='#444', style='italic')

    # Chart patches (overlapping ellipses on the manifold)
    charts = [
        (1.0, 3.8, 1.2, 0.6, 20, '#cc4444', 'Affine\nslice'),
        (2.8, 3.6, 1.0, 0.5, -10, '#2266aa', '$(L_z, E)$'),
        (1.5, 1.5, 0.9, 0.5, 30, '#228833', 'Shape\nsphere'),
        (2.8, 1.8, 1.1, 0.5, -20, '#cc8800', 'Burrau\nfamily'),
    ]

    for cx, cy, w, h, angle, color, label in charts:
        e = Ellipse((cx, cy), w*2, h*2, angle=angle,
                    facecolor=color, alpha=0.15, edgecolor=color, lw=1.5, ls='--')
        ax.add_patch(e)
        ax.text(cx, cy, label, ha='center', va='center', fontsize=6.5,
                color=color, fontweight='bold')

    # Arrows from charts to UV squares
    uv_x = 6.5
    charts_target = [
        (1.0, 3.8, '#cc4444', 4.5, 'Affine'),
        (2.8, 3.6, '#2266aa', 3.3, '$(L_z, E)$'),
        (1.5, 1.5, '#228833', 2.1, 'Shape sphere'),
        (2.8, 1.8, '#cc8800', 0.9, 'Burrau'),
    ]

    for cx, cy, color, target_y, label in charts_target:
        ax.annotate('', xy=(uv_x - 0.7, target_y),
                    xytext=(cx + 0.6, cy),
                    arrowprops=dict(arrowstyle='->', color=color, lw=1.2,
                                   connectionstyle='arc3,rad=0.15'))

    # UV squares (rendering domain)
    for i, (_, _, color, target_y, label) in enumerate(charts_target):
        rect = plt.Rectangle((uv_x - 0.6, target_y - 0.45), 1.2, 0.9,
                             facecolor=color, alpha=0.12, edgecolor=color, lw=1.5)
        ax.add_patch(rect)
        ax.text(uv_x, target_y, '$[0,1]^2$', ha='center', va='center',
                fontsize=7, color=color, fontweight='bold')
        ax.text(uv_x + 1.0, target_y, label, fontsize=7, va='center',
                color=color, fontweight='bold')

    # Labels
    ax.text(uv_x, 5.1, 'Rendering domain', fontsize=9, ha='center',
            fontweight='bold', color='#333')
    ax.annotate('$\\Phi$  (chart map)', xy=(4.5, 3.0), fontsize=9,
                ha='center', color='#666', fontweight='bold')
    ax.text(4.5, 2.6, 'Each chart $\\Phi_k : [0,1]^2 \\to Y_k$\nmaps the same manifold\nthrough a different lens',
            fontsize=7, ha='center', color='#888', style='italic')

    # Shared decoder
    _box(ax, 6.5, -0.3, 2.0, 0.6,
         'Shared: $D \\circ C \\to (m_i, r_i, p_i)$\nGPU shader is chart-agnostic',
         '#f0e6ff', fontsize=7, bold=True, edgecolor='#7744aa')

    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'chart_atlas.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.12)
    plt.close(fig)
    print("  -> chart_atlas.png")


# ============================================================
# 2. SLICE ROTATION / TILT
# ============================================================
def gen_slice_tilt():
    fig, axes = plt.subplots(1, 3, figsize=(11, 4),
                             subplot_kw={'projection': '3d'})
    fig.suptitle('Tilt: Rotating the 2D Viewing Plane Through New Dimensions',
                 fontsize=11, fontweight='bold', y=0.98)

    tilt_angles = [0, 0.3, 0.7]
    tilt_labels = ['$\\tau = 0$\n(base slice)', '$\\tau = 0.3$\n(tilting into $z_5$)',
                   '$\\tau = 0.7$\n(deep tilt)']

    for idx, (ax, tilt, label) in enumerate(zip(axes, tilt_angles, tilt_labels)):
        # Draw a faint cube (the ambient space)
        for s in [-1, 1]:
            for dim in range(3):
                pts = np.array([[-1,-1], [-1,1], [1,1], [1,-1], [-1,-1]])
                xs, ys = pts[:,0], pts[:,1]
                zs = np.full_like(xs, s)
                if dim == 0:
                    ax.plot(zs, xs, ys, '-', color='#ddd', lw=0.4, alpha=0.3)
                elif dim == 1:
                    ax.plot(xs, zs, ys, '-', color='#ddd', lw=0.4, alpha=0.3)
                else:
                    ax.plot(xs, ys, zs, '-', color='#ddd', lw=0.4, alpha=0.3)

        # The 2D plane at this tilt
        u = np.linspace(-0.9, 0.9, 10)
        v = np.linspace(-0.9, 0.9, 10)
        U, V = np.meshgrid(u, v)

        # Tilt rotates q2 into the z direction
        X = U
        Y = V * np.cos(tilt)
        Z = V * np.sin(tilt)

        ax.plot_surface(X, Y, Z, alpha=0.25, color='#4488cc',
                       edgecolor='#2266aa', linewidth=0.3)

        # Lock point
        ax.scatter(0, 0, 0, s=60, c='red', zorder=10, edgecolors='darkred')

        # q1 vector (always in x)
        ax.quiver(0, 0, 0, 0.7, 0, 0, color='#cc4444', arrow_length_ratio=0.12, lw=2)
        ax.text(0.8, 0, 0, '$q_1$', fontsize=8, color='#cc4444')

        # q2 vector (rotates with tilt)
        q2y = 0.7 * np.cos(tilt)
        q2z = 0.7 * np.sin(tilt)
        ax.quiver(0, 0, 0, 0, q2y, q2z, color='#2266aa', arrow_length_ratio=0.12, lw=2)
        ax.text(0, q2y + 0.05, q2z + 0.1, '$q_2$', fontsize=8, color='#2266aa')

        # Axis labels for the ambient dimensions
        ax.text(1.1, 0, 0, '$z_3$', fontsize=7, color='#888')
        ax.text(0, 1.1, 0, '$z_4$', fontsize=7, color='#888')
        ax.text(0, 0, 1.1, '$z_5$', fontsize=7, color='#888')

        ax.set_xlim([-1.2, 1.2])
        ax.set_ylim([-1.2, 1.2])
        ax.set_zlim([-1.2, 1.2])
        ax.set_box_aspect([1, 1, 1])
        ax.axis('off')
        ax.view_init(elev=20, azim=35)
        ax.set_title(label, fontsize=8, pad=-5)

    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'slice_tilt.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.1)
    plt.close(fig)
    print("  -> slice_tilt.png")


# ============================================================
# 3. FACTORISATION DIAGRAM
# ============================================================
def gen_factorisation():
    fig, ax = plt.subplots(1, 1, figsize=(9, 3.5))
    ax.set_xlim(-0.5, 9.5)
    ax.set_ylim(-0.5, 3.5)
    ax.axis('off')
    ax.set_title('IC Manifold Factorisation: $Y \\cong Y_{mass} \\times Y_{cfg} \\times Y_{mom}$',
                 fontsize=11, fontweight='bold', pad=10)

    # Three subspaces
    spaces = [
        (1.2, 2.2, '$Y_{mass}$\n2 DOF', '#cc4444',
         'softmax$(0, \\mu_1, \\mu_2)$\n$\\to (m_1, m_2, m_3)$\n$\\sum m_i = 1$'),
        (4.0, 2.2, '$Y_{cfg}$\n3 DOF', '#2266aa',
         'Hyperspherical Jacobi\n$(\\alpha, \\beta) \\to (\\tilde{\\rho}, \\tilde{\\lambda})$\n$I = 1$ (scale gauge)'),
        (6.8, 2.2, '$Y_{mom}$\n4 DOF', '#228833',
         'Free momenta or\n$(L_z, K)$ invariant\n$\\sum p_i = 0$ (COM)'),
    ]

    for x, y, label, color, desc in spaces:
        _box(ax, x, y, 2.0, 0.8, label, color + '22', edgecolor=color,
             fontsize=10, bold=True, textcolor=color)
        ax.text(x, y - 0.75, desc, ha='center', va='top', fontsize=6.5,
                color='#444')

    # × symbols
    ax.text(2.6, 2.2, '×', fontsize=16, ha='center', va='center',
            color='#888', fontweight='bold')
    ax.text(5.4, 2.2, '×', fontsize=16, ha='center', va='center',
            color='#888', fontweight='bold')

    # Arrow to assembled IC
    ax.annotate('', xy=(8.8, 2.2), xytext=(7.9, 2.2),
                arrowprops=dict(arrowstyle='->', color='#555', lw=2))

    _box(ax, 9.3, 2.2, 0.9, 0.8, '$(m_i,$\n$r_i,$\n$p_i)$',
         '#f0e6ff', edgecolor='#7744aa', fontsize=8, bold=True)

    # DOF counting
    ax.text(4.0, 0.3, 'Total: 2 + 3 + 4 = 9 internal DOF '
            '(10 latent coordinates, 1 redundant for flexibility)',
            ha='center', fontsize=7.5, color='#666',
            bbox=dict(boxstyle='round,pad=0.3', facecolor='#f8f8f8', edgecolor='#ddd'))

    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'factorisation.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.12)
    plt.close(fig)
    print("  -> factorisation.png")


# ============================================================
# 4. INJECTIVITY / SEAMS / NO-HOLES
# ============================================================
def gen_injectivity():
    fig, axes = plt.subplots(1, 3, figsize=(10, 3.8))
    fig.suptitle('Injectivity Caveats: Seams, Deadbands, and the No-Holes Guarantee',
                 fontsize=11, fontweight='bold', y=1.0)

    # Panel 1: Seam on the UV square
    ax = axes[0]
    ax.set_xlim(-0.1, 1.1)
    ax.set_ylim(-0.1, 1.1)
    ax.set_aspect('equal')
    ax.set_title('Canonical frame seam', fontsize=9, fontweight='bold')

    # UV square
    rect = plt.Rectangle((0, 0), 1, 1, facecolor='#eef4ff', edgecolor='#333', lw=1.5)
    ax.add_patch(rect)

    # Seam line (where lambda_y crosses zero)
    ax.plot([0, 1], [0.5, 0.5], '-', color='#cc4444', lw=2.5)
    ax.text(0.5, 0.53, 'Seam: $\\tilde{\\lambda}_y = 0$', ha='center',
            fontsize=7.5, color='#cc4444', fontweight='bold')

    # Deadband zone
    ax.fill_between([0, 1], [0.47, 0.47], [0.53, 0.53],
                    alpha=0.2, color='#cc4444')
    ax.text(0.85, 0.44, '$\\delta_{\\lambda}$', fontsize=7, color='#cc4444')

    # Normal region labels
    ax.text(0.5, 0.75, '$\\tilde{\\lambda}_y > 0$\n(canonical)', ha='center',
            fontsize=7.5, color='#228833')
    ax.text(0.5, 0.25, '$\\tilde{\\lambda}_y < 0$\n(mirrored to $> 0$)', ha='center',
            fontsize=7.5, color='#888')

    ax.set_xlabel('$u$', fontsize=8)
    ax.set_ylabel('$v$', fontsize=8)
    ax.tick_params(labelsize=6)

    # Panel 2: Degenerate point
    ax2 = axes[1]
    ax2.set_xlim(-0.1, 1.1)
    ax2.set_ylim(-0.1, 1.1)
    ax2.set_aspect('equal')
    ax2.set_title('Degenerate configurations', fontsize=9, fontweight='bold')

    rect2 = plt.Rectangle((0, 0), 1, 1, facecolor='#eef4ff', edgecolor='#333', lw=1.5)
    ax2.add_patch(rect2)

    # A degenerate point
    ax2.plot(0.3, 0.7, 'x', markersize=12, color='#cc4444', markeredgewidth=2.5, zorder=10)
    ax2.text(0.35, 0.73, 'DEGENERATE\n$(M_{01} < \\varepsilon)$',
             fontsize=6.5, color='#cc4444', fontweight='bold')

    # Collision-at-t=0 region
    ax2.plot(0.8, 0.2, 'x', markersize=10, color='#cc8800', markeredgewidth=2, zorder=10)
    ax2.text(0.85, 0.23, 'COLLISION_T0\n$(r_{min}(0) < r_{coll})$',
             fontsize=6, color='#cc8800', fontweight='bold')

    # Normal pixels
    for _ in range(30):
        px, py = np.random.uniform(0.05, 0.95, 2)
        if abs(px - 0.3) > 0.15 or abs(py - 0.7) > 0.15:
            if abs(px - 0.8) > 0.15 or abs(py - 0.2) > 0.15:
                ax2.plot(px, py, '.', color='#228833', markersize=2, alpha=0.5)

    ax2.text(0.5, -0.07, 'Every pixel gets a label — no holes',
             ha='center', fontsize=7, color='#228833', fontweight='bold')
    ax2.set_xlabel('$u$', fontsize=8)
    ax2.set_ylabel('$v$', fontsize=8)
    ax2.tick_params(labelsize=6)

    # Panel 3: The totality guarantee
    ax3 = axes[2]
    ax3.set_xlim(-0.5, 4.5)
    ax3.set_ylim(-0.5, 5)
    ax3.axis('off')
    ax3.set_title('No-holes guarantee', fontsize=9, fontweight='bold')

    flow_items = [
        (2.0, 4.3, 'UV pixel $(u,v)$', '#e8e8e8'),
        (2.0, 3.3, 'Decode $D(\\Phi(u,v))$', '#dbe9f7'),
        (2.0, 2.3, 'Canonicalise $C$', '#dbe9f7'),
    ]
    for x, y, text, color in flow_items:
        _box(ax3, x, y, 2.2, 0.6, text, color, fontsize=8, bold=True)

    # Arrows
    for i in range(len(flow_items) - 1):
        ax3.annotate('', xy=(2.0, flow_items[i+1][1] + 0.35),
                    xytext=(2.0, flow_items[i][1] - 0.35),
                    arrowprops=dict(arrowstyle='->', color='#555', lw=1.2))

    # Branch: success or tagged terminal
    ax3.annotate('', xy=(0.5, 1.0), xytext=(1.5, 1.95),
                arrowprops=dict(arrowstyle='->', color='#228833', lw=1.2))
    ax3.annotate('', xy=(3.5, 1.0), xytext=(2.5, 1.95),
                arrowprops=dict(arrowstyle='->', color='#cc4444', lw=1.2))

    _box(ax3, 0.5, 0.6, 1.5, 0.6, 'Valid IC\n→ simulate', '#d4edda',
         fontsize=7, bold=True, edgecolor='#228833')
    _box(ax3, 3.5, 0.6, 1.5, 0.6, 'Terminal tag\n(labelled, not\nrejected)', '#fde8e8',
         fontsize=7, bold=True, edgecolor='#cc4444')

    ax3.text(1.0, 1.6, 'success', fontsize=7, color='#228833', fontweight='bold')
    ax3.text(3.0, 1.6, 'degenerate', fontsize=7, color='#cc4444', fontweight='bold')

    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'injectivity.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.12)
    plt.close(fig)
    print("  -> injectivity.png")


# ============================================================
# 5. SHAPE SPHERE COLOURED BY ALPHA
# ============================================================
def gen_alpha_sphere():
    fig, axes = plt.subplots(1, 2, figsize=(9, 4.5))

    # Left: 3D sphere coloured by alpha
    ax = fig.add_subplot(121, projection='3d')

    n_pts = 250
    u = np.linspace(0, 2*np.pi, n_pts)
    v = np.linspace(0, np.pi, n_pts)
    x = np.outer(np.cos(u), np.sin(v))
    y = np.outer(np.sin(u), np.sin(v))
    z = np.outer(np.ones_like(u), np.cos(v))

    # Alpha on the shape sphere: alpha = arccos(nz) roughly maps to
    # the polar angle. More precisely, for the shape sphere:
    # n = (2rho.lambda, 2(rho x lambda)_z, |rho|^2 - |lambda|^2) / I
    # so nz = (|rho|^2 - |lambda|^2) / I
    # and alpha = atan2(|lambda_tilde|, |rho_tilde|)
    # so cos(2*alpha) = nz, meaning alpha = arccos(nz)/2

    alpha_vals = np.arccos(np.clip(z, -1, 1)) / 2  # maps [0, pi] -> [0, pi/2]

    # Normalise to [0, 1] for colourmap
    alpha_norm = alpha_vals / (np.pi / 2)

    # Use a good diverging colourmap
    cmap = plt.cm.RdYlBu_r
    colors = cmap(alpha_norm)

    ax.plot_surface(x, y, z, facecolors=colors, rstride=1, cstride=1,
                    antialiased=True, shade=False)

    # Mark key points
    # Poles: alpha=0 (north, tight inner pair) and alpha=pi/2 (south, equal scales)
    ax.scatter(0, 0, 1, s=80, c='#cc4444', zorder=10, edgecolors='darkred', lw=1)
    ax.text(0, 0, 1.15, '$\\alpha \\approx 0$\ntight pair', fontsize=6,
            ha='center', color='darkred', fontweight='bold')

    ax.scatter(0, 0, -1, s=80, c='#2266aa', zorder=10, edgecolors='#113355', lw=1)
    ax.text(0, 0, -1.2, '$\\alpha \\approx \\pi/2$\ncomparable', fontsize=6,
            ha='center', va='top', color='#113355', fontweight='bold')

    # Equator: alpha = pi/4 (equal |rho| and |lambda|)
    theta_eq = np.linspace(0, 2*np.pi, 100)
    ax.plot(np.cos(theta_eq), np.sin(theta_eq), np.zeros_like(theta_eq),
            '-', color='white', lw=1.5, alpha=0.8)
    ax.text(1.1, 0, 0.05, '$\\alpha = \\pi/4$', fontsize=6, color='#555')

    ax.set_xlim([-1.3, 1.3])
    ax.set_ylim([-1.3, 1.3])
    ax.set_zlim([-1.3, 1.3])
    ax.set_box_aspect([1, 1, 1])
    ax.axis('off')
    ax.view_init(elev=20, azim=40)
    ax.set_title('Shape sphere $S^2$\ncoloured by $\\alpha$', fontsize=9, fontweight='bold')

    # Right: example triangles at different alpha values
    ax2 = axes[1]
    ax2.set_xlim(-0.5, 4.5)
    ax2.set_ylim(-0.8, 3.5)
    ax2.set_aspect('equal')
    ax2.axis('off')
    ax2.set_title('Triangle shapes at marked $\\alpha$ values', fontsize=9, fontweight='bold')

    alphas = [0.1, 0.35, 0.6, 0.85, 1.1, 1.35]
    beta_fixed = 0.85
    cols = 3
    rows = 2

    cmap_tri = plt.cm.RdYlBu_r

    for i, alpha in enumerate(alphas):
        col = i % cols
        row = i // cols
        x0 = col * 1.5 + 0.3
        y0 = (1 - row) * 1.7 + 0.3

        rho_m = np.cos(alpha)
        lam_m = np.sin(alpha)

        # Triangle from Jacobi
        scale = 0.5
        p1 = np.array([x0, y0])
        p2 = np.array([x0 + rho_m * scale, y0])
        lam_vec = lam_m * scale * np.array([np.cos(beta_fixed), np.sin(beta_fixed)])
        com12 = (p1 + p2) / 2
        p3 = com12 + lam_vec

        pts = np.array([p1, p2, p3])
        tri = np.vstack([pts, pts[0]])

        # Colour by alpha
        c = cmap_tri(alpha / (np.pi/2))
        ax2.plot(tri[:, 0], tri[:, 1], '-', color='#444', lw=1.2)
        ax2.fill(pts[:, 0], pts[:, 1], alpha=0.3, color=c)

        for j in range(3):
            ax2.plot(pts[j, 0], pts[j, 1], 'o', markersize=[5, 4, 3][j],
                    color=['#cc4444', '#2266aa', '#228833'][j],
                    markeredgecolor='#333', lw=0.4, zorder=10)

        ax2.text(x0 + rho_m * scale / 2, y0 - 0.3,
                 f'$\\alpha = {alpha:.2f}$', fontsize=6, ha='center',
                 fontweight='bold', color='#333',
                 bbox=dict(boxstyle='round,pad=0.1', facecolor=c, alpha=0.3,
                          edgecolor='none'))

    # Labels
    ax2.text(0.7, -0.6, 'Tight inner pair\n(hierarchical)',
             fontsize=7, ha='center', color='#cc4444', fontweight='bold')
    ax2.text(3.7, -0.6, 'Comparable scales\n(compact)',
             fontsize=7, ha='center', color='#2266aa', fontweight='bold')

    ax2.annotate('', xy=(3.5, -0.45), xytext=(1.0, -0.45),
                arrowprops=dict(arrowstyle='->', color='#888', lw=1.2))

    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'alpha_sphere.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.12)
    plt.close(fig)
    print("  -> alpha_sphere.png")


# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    print("Generating manifold navigation diagrams...")
    gen_chart_atlas()
    gen_slice_tilt()
    gen_factorisation()
    gen_injectivity()
    gen_alpha_sphere()
    print("Done.")
