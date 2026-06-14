"""
Completely redesigned:
1. Chart atlas - manifold blob with coordinate vectors, arrows to chart labels
2. Slicing - manifold blob with tilted plane, arrow to 2D cross-section
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Ellipse
import os

OUT = "/home/claude"
DPI = 200


def _blob(ax, cx, cy, scale=1.0, color='#888', alpha=0.08):
    """Draw an organic manifold blob."""
    theta = np.linspace(0, 2*np.pi, 200)
    r = scale * (1.0 + 0.12*np.sin(3*theta) + 0.08*np.cos(5*theta) 
                 + 0.05*np.sin(7*theta))
    ax.fill(cx + r*np.cos(theta), cy + r*np.sin(theta),
            alpha=alpha, color=color, edgecolor=color, lw=1.5, 
            linestyle='-', zorder=1)


# ============================================================
# 1. CHART ATLAS
# ============================================================
def gen_chart_atlas():
    fig, ax = plt.subplots(1, 1, figsize=(10, 7))
    ax.set_xlim(-4.5, 5.5)
    ax.set_ylim(-4.5, 4.5)
    ax.set_aspect('equal')
    ax.axis('off')

    # The manifold blob, centred
    _blob(ax, 0, 0, scale=2.2, color='#666', alpha=0.07)
    ax.text(0, 0, r'$\mathcal{M}$' + '\n10D IC\nManifold',
            ha='center', va='center', fontsize=13, color='#555',
            fontweight='bold', style='italic', zorder=5)

    # Define coordinate pairs with their visual directions on the blob
    # Each chart: (origin_offset, vec1_dir, vec2_dir, color, label, sublabel)
    charts = [
        # Top-right: Affine slice (z3, z4)
        {
            'origin': (0.3, 0.5),
            'v1': (1.2, 0.3), 'v2': (0.2, 1.1),
            'v1_label': r'$q_1$', 'v2_label': r'$q_2$',
            'color': '#cc4444',
            'label': 'Affine slice',
            'sublabel': r'$z_0 + (2s-1)q_1 + (2t-1)q_2$',
            'label_pos': (4.2, 3.5),
            'arrow_from': (1.2, 1.3),
        },
        # Top-left: (Lz, E) invariant
        {
            'origin': (-0.3, 0.3),
            'v1': (-1.1, 0.4), 'v2': (-0.3, 1.2),
            'v1_label': r'$L_z$', 'v2_label': r'$E$',
            'color': '#2266aa',
            'label': r'$(L_z, E)$ chart',
            'sublabel': 'Invariant momentum\nconstruction',
            'label_pos': (-3.8, 3.5),
            'arrow_from': (-1.1, 1.3),
        },
        # Bottom-left: Shape sphere
        {
            'origin': (-0.4, -0.4),
            'v1': (-1.0, -0.5), 'v2': (-0.5, -1.0),
            'v1_label': r'$\theta$', 'v2_label': r'$\varphi$',
            'color': '#228833',
            'label': 'Shape sphere',
            'sublabel': r'$(θ, φ)$ projection of $S^2$',
            'label_pos': (-3.8, -3.5),
            'arrow_from': (-1.2, -1.2),
        },
        # Bottom-right: Burrau family
        {
            'origin': (0.4, -0.3),
            'v1': (1.1, -0.5), 'v2': (0.3, -1.1),
            'v1_label': r'$\nu$', 'v2_label': r'$K$',
            'color': '#cc8800',
            'label': 'Burrau family',
            'sublabel': r'Triangle shape $\nu$ vs' + '\nkinetic energy',
            'label_pos': (4.2, -3.5),
            'arrow_from': (1.1, -1.2),
        },
    ]

    for chart in charts:
        ox, oy = chart['origin']
        v1x, v1y = chart['v1']
        v2x, v2y = chart['v2']
        col = chart['color']

        # Draw basis vectors on the manifold
        ax.annotate('', xy=(ox + v1x, oy + v1y), xytext=(ox, oy),
                    arrowprops=dict(arrowstyle='->', color=col, lw=2.5),
                    zorder=6)
        ax.annotate('', xy=(ox + v2x, oy + v2y), xytext=(ox, oy),
                    arrowprops=dict(arrowstyle='->', color=col, lw=2.5),
                    zorder=6)

        # Vector labels
        ax.text(ox + v1x * 0.55 + 0.12, oy + v1y * 0.55 - 0.05,
                chart['v1_label'], fontsize=9, color=col, fontweight='bold',
                zorder=7)
        ax.text(ox + v2x * 0.55 - 0.05, oy + v2y * 0.55 + 0.12,
                chart['v2_label'], fontsize=9, color=col, fontweight='bold',
                zorder=7)

        # Origin dot
        ax.plot(ox, oy, 'o', markersize=4, color=col, zorder=7)

        # Dashed region wedge (light fill in the quadrant)
        wedge_pts = np.array([
            [ox, oy],
            [ox + v1x * 0.9, oy + v1y * 0.9],
            [ox + (v1x + v2x) * 0.6, oy + (v1y + v2y) * 0.6],
            [ox + v2x * 0.9, oy + v2y * 0.9],
        ])
        ax.fill(wedge_pts[:, 0], wedge_pts[:, 1], alpha=0.06,
                color=col, zorder=2)

        # Arrow from the quadrant region to the label
        afx, afy = chart['arrow_from']
        lx, ly = chart['label_pos']
        ax.annotate('', xy=(lx, ly), xytext=(afx, afy),
                    arrowprops=dict(arrowstyle='->', color=col, lw=1.5,
                                   connectionstyle='arc3,rad=0.15',
                                   alpha=0.7),
                    zorder=4)

        # Chart label box
        ax.text(lx, ly, chart['label'] + '\n' + chart['sublabel'],
                ha='center', va='center', fontsize=8.5,
                color=col, fontweight='bold',
                bbox=dict(boxstyle='round,pad=0.35', facecolor=col + '12',
                         edgecolor=col, lw=1.2),
                zorder=8, linespacing=1.4)

    # Shared decoder annotation at bottom
    ax.text(0, -4.2,
            r'All charts $\to$ shared decoder $D \circ C \to (m_i, r_i, p_i)$'
            '  —  GPU shader is chart-agnostic',
            ha='center', fontsize=8.5, color='#7744aa', fontweight='bold',
            bbox=dict(boxstyle='round,pad=0.3', facecolor='#f0e6ff',
                     edgecolor='#7744aa', lw=1.2))

    fig.savefig(os.path.join(OUT, 'chart_atlas.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.15)
    plt.close(fig)
    print("  -> chart_atlas.png")


# ============================================================
# 2. SLICING DIAGRAM
# ============================================================
def gen_slicing():
    fig, axes = plt.subplots(1, 2, figsize=(11, 5.5),
                             gridspec_kw={'width_ratios': [1.2, 1], 'wspace': 0.3})

    # --- Left panel: manifold blob with slicing plane ---
    ax = axes[0]
    ax.set_xlim(-3.5, 3.5)
    ax.set_ylim(-3.5, 3.5)
    ax.set_aspect('equal')
    ax.axis('off')
    ax.set_title('Slicing the 10D manifold', fontsize=11, fontweight='bold', pad=8)

    # Manifold blob
    _blob(ax, 0, 0, scale=2.5, color='#666', alpha=0.07)
    ax.text(-0.9, -0.5, r'$\mathcal{M}$', fontsize=16, color='#555',
            fontweight='bold', style='italic')

    # The slicing plane as a tilted parallelogram
    # Slightly tilted in all directions for visual interest
    plane_centre = np.array([0.2, 0.1])
    # Basis vectors for the plane (slightly tilted)
    e1 = np.array([1.8, 0.3])  # mostly horizontal
    e2 = np.array([-0.2, 1.6])  # mostly vertical

    corners = np.array([
        plane_centre - 0.5*e1 - 0.5*e2,
        plane_centre + 0.5*e1 - 0.5*e2,
        plane_centre + 0.5*e1 + 0.5*e2,
        plane_centre - 0.5*e1 + 0.5*e2,
    ])

    # Draw the plane
    plane = plt.Polygon(corners, facecolor='#4488cc', alpha=0.18,
                        edgecolor='#2266aa', lw=2, ls='-', zorder=3)
    ax.add_patch(plane)

    # Basis vectors on the plane
    ax.annotate('', xy=plane_centre + 0.4*e1, xytext=plane_centre,
                arrowprops=dict(arrowstyle='->', color='#cc4444', lw=2.5),
                zorder=6)
    ax.text(plane_centre[0] + 0.4*e1[0] + 0.1,
            plane_centre[1] + 0.4*e1[1] + 0.1,
            r'$q_1$', fontsize=11, color='#cc4444', fontweight='bold', zorder=7)

    ax.annotate('', xy=plane_centre + 0.4*e2, xytext=plane_centre,
                arrowprops=dict(arrowstyle='->', color='#2266aa', lw=2.5),
                zorder=6)
    ax.text(plane_centre[0] + 0.4*e2[0] - 0.3,
            plane_centre[1] + 0.4*e2[1] + 0.05,
            r'$q_2$', fontsize=11, color='#2266aa', fontweight='bold', zorder=7)

    # Lock point
    ax.plot(plane_centre[0], plane_centre[1], 'o', markersize=8,
            color='red', markeredgecolor='darkred', lw=1.5, zorder=8)
    ax.text(plane_centre[0] + 0.2, plane_centre[1] - 0.25,
            r'$z_0$', fontsize=10, color='darkred', fontweight='bold')

    # Dim labels for out-of-plane directions
    ax.annotate('', xy=(0.2, 2.8), xytext=(0.2, 2.0),
                arrowprops=dict(arrowstyle='->', color='#aaa', lw=1, ls='--'),
                zorder=2)
    ax.text(0.35, 2.8, r'$z_5, z_6, \ldots$ (hidden dims)', fontsize=7,
            color='#aaa', style='italic')

    # Cross-section line on the blob edge (where plane intersects blob)
    theta = np.linspace(-0.8, 0.8, 50)
    cx = 2.3 * np.cos(theta + 0.3) + 0.2
    cy = 2.3 * np.sin(theta + 0.3) + 0.1
    # Don't draw this, the plane polygon already shows the intersection

    # Annotation
    ax.text(0, -3.2,
            'The 2D viewing plane cuts through\n'
            'the manifold at orientation $(q_1, q_2)$.\n'
            'Tilt rotates this plane into new dimensions.',
            ha='center', fontsize=7.5, color='#555',
            bbox=dict(boxstyle='round,pad=0.3', facecolor='#f8f8f8',
                     edgecolor='#ddd'))

    # --- Right panel: the resulting 2D cross-section (what you see) ---
    ax2 = axes[1]
    ax2.set_xlim(-0.15, 1.15)
    ax2.set_ylim(-0.15, 1.15)
    ax2.set_aspect('equal')
    ax2.set_title('What the renderer shows', fontsize=11, fontweight='bold', pad=8)

    # UV square
    rect = plt.Rectangle((0, 0), 1, 1, facecolor='#f4f4f4',
                         edgecolor='#333', lw=1.5, zorder=1)
    ax2.add_patch(rect)

    # Simulate a basin-like pattern
    np.random.seed(42)
    n_pts = 5000
    us = np.random.uniform(0, 1, n_pts)
    vs = np.random.uniform(0, 1, n_pts)

    # Simple fractal-ish basin boundary
    boundary = 0.5 + 0.15*np.sin(8*np.pi*us) + 0.1*np.cos(6*np.pi*vs)
    colors = np.where(vs > boundary, '#cc4444', '#2266aa')

    ax2.scatter(us, vs, c=colors, s=0.3, alpha=0.6, zorder=2, edgecolors='none')

    # Axis labels
    ax2.set_xlabel(r'$u$ (along $q_1$)', fontsize=9)
    ax2.set_ylabel(r'$v$ (along $q_2$)', fontsize=9)
    ax2.tick_params(labelsize=7)

    # Lock point on the cross-section
    ax2.plot(0.5, 0.5, 'o', markersize=6, color='red',
             markeredgecolor='darkred', lw=1.2, zorder=10)
    ax2.text(0.54, 0.53, r'$z_0$', fontsize=8, color='darkred', fontweight='bold')

    # Basin labels
    ax2.text(0.2, 0.85, 'Basin A\n(escape 1-2)', fontsize=7, ha='center',
             color='#2266aa', fontweight='bold',
             bbox=dict(boxstyle='round,pad=0.15', facecolor='white',
                      edgecolor='#2266aa', alpha=0.9))
    ax2.text(0.8, 0.15, 'Basin B\n(escape 2-3)', fontsize=7, ha='center',
             color='#cc4444', fontweight='bold',
             bbox=dict(boxstyle='round,pad=0.15', facecolor='white',
                      edgecolor='#cc4444', alpha=0.9))

    # Arrow between left and right panels
    fig.text(0.5, 0.5, r'$\longrightarrow$', fontsize=28, ha='center',
             va='center', color='#555', transform=fig.transFigure)
    fig.text(0.5, 0.44, 'render this\ncross-section', fontsize=8, ha='center',
             va='top', color='#555', style='italic', transform=fig.transFigure)

    fig.savefig(os.path.join(OUT, 'manifold_projections.png'), dpi=DPI,
                bbox_inches='tight', facecolor='white', pad_inches=0.15)
    plt.close(fig)
    print("  -> manifold_projections.png")


# ============================================================
if __name__ == "__main__":
    print("Redesigning figures 3 and 4 from scratch...")
    gen_chart_atlas()
    gen_slicing()
    print("Done.")
