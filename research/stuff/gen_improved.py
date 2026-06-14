"""
Improved and new diagrams for the Principia spec.
1. Symmetry reduction cascade (improved)
2. Hyperspherical Jacobi (improved)
3. Linearised decoder for deep zoom (new)
4. KDK leapfrog structure (new)
5. Adaptive substepping near close encounters (new)
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Arc, Circle, Polygon
import matplotlib.patheffects as pe
import os

OUT = "/home/claude"
DPI = 200


# ============================================================
# 1. SYMMETRY REDUCTION CASCADE (improved)
# ============================================================
def gen_symmetry_cascade():
    fig, axes = plt.subplots(1, 5, figsize=(13, 3.5),
                             gridspec_kw={'wspace': 0.05})
    fig.suptitle('Symmetry Reduction: Physical Configuration → Reduced Description',
                 fontsize=11, fontweight='bold', y=0.98)
    
    # Consistent style
    body_colors = ['#cc4444', '#2266aa', '#228833']
    body_sizes = [10, 8, 6]
    
    def draw_triangle(ax, pts, title, subtitle, annotations=None, extras=None):
        ax.set_xlim(-2, 2)
        ax.set_ylim(-2, 2)
        ax.set_aspect('equal')
        ax.axis('off')
        ax.set_title(title + '\n' + subtitle, fontsize=7.5, fontweight='bold', pad=6)
        
        # Triangle edges
        tri = np.vstack([pts, pts[0]])
        ax.plot(tri[:, 0], tri[:, 1], '-', color='#444', lw=1.3)
        ax.fill(pts[:, 0], pts[:, 1], alpha=0.08, color='#4488cc')
        
        # Bodies
        for i in range(3):
            ax.plot(pts[i, 0], pts[i, 1], 'o', markersize=body_sizes[i],
                    color=body_colors[i], markeredgecolor='#333', lw=0.7, zorder=10)
            ax.text(pts[i, 0] + 0.15, pts[i, 1] + 0.15, f'$m_{i+1}$',
                    fontsize=6, color=body_colors[i])
        
        if annotations:
            annotations(ax, pts)
        if extras:
            extras(ax)
    
    # Panel 1: Arbitrary config
    pts0 = np.array([[0.8, 1.2], [-1.1, 0.3], [0.5, -0.9]])
    draw_triangle(axes[0], pts0, 'Physical',
                  '12 DOF\n(3 bodies × 2 pos + 2 mom)')
    
    # Panel 2: COM frame
    pts1 = pts0 - np.mean(pts0, axis=0)
    def com_annot(ax, pts):
        ax.plot(0, 0, '+', color='#888', markersize=12, markeredgewidth=2, zorder=5)
        ax.text(0.15, -0.2, 'COM', fontsize=6, color='#888')
        # Ghost of original position
        for p in pts0:
            ax.plot(p[0] - np.mean(pts0[:, 0]), p[1], 'o', markersize=3,
                    color='#ddd', zorder=1)
    draw_triangle(axes[1], pts1, 'COM frame',
                  '8 DOF\n($\\Sigma m_i r_i = 0$, $\\Sigma p_i = 0$)',
                  com_annot)
    
    # Panel 3: Rotate rho to +x
    # Compute Jacobi rho = r2 - r1, rotate so it's along +x
    rho = pts1[1] - pts1[0]
    angle = np.arctan2(rho[1], rho[0])
    R = np.array([[np.cos(-angle), -np.sin(-angle)],
                  [np.sin(-angle), np.cos(-angle)]])
    pts2 = (R @ pts1.T).T
    def rot_annot(ax, pts):
        ax.plot(0, 0, '+', color='#888', markersize=10, markeredgewidth=1.5, zorder=5)
        # Draw rho vector
        ax.annotate('', xy=pts[1], xytext=pts[0],
                    arrowprops=dict(arrowstyle='->', color='#cc4444', lw=2))
        ax.text((pts[0, 0] + pts[1, 0])/2, (pts[0, 1] + pts[1, 1])/2 - 0.25,
                '$\\tilde{\\rho}$ along $+x$', fontsize=6, color='#cc4444',
                ha='center', fontweight='bold')
        # x-axis
        ax.axhline(0, color='#cc4444', lw=0.5, ls=':', alpha=0.5, xmin=0.1, xmax=0.9)
    draw_triangle(axes[2], pts2, 'Canonical rotation',
                  '7 DOF\n(rotate $\\tilde{\\rho}$ to $+x$)',
                  rot_annot)
    
    # Panel 4: Mirror lambda_y >= 0
    pts3 = pts2.copy()
    if pts3[2, 1] < 0:
        pts3[:, 1] = -pts3[:, 1]
    def mirror_annot(ax, pts):
        ax.plot(0, 0, '+', color='#888', markersize=10, markeredgewidth=1.5, zorder=5)
        ax.axhline(0, color='#aaa', lw=1, ls='--')
        ax.fill_between([-2, 2], [0, 0], [2, 2], alpha=0.04, color='#228833')
        ax.text(1.3, 1.5, '$\\tilde{\\lambda}_y \\geq 0$', fontsize=7,
                color='#228833', fontweight='bold')
        # Lambda vector
        com01 = (pts[0] + pts[1]) / 2  # simplified
        ax.annotate('', xy=pts[2], xytext=com01,
                    arrowprops=dict(arrowstyle='->', color='#2266aa', lw=2))
        ax.text(com01[0] - 0.4, (com01[1] + pts[2, 1])/2,
                '$\\tilde{\\lambda}$', fontsize=7, color='#2266aa', fontweight='bold')
    draw_triangle(axes[3], pts3, 'Mirror fixed',
                  '6 DOF\n($\\tilde{\\lambda}_y \\geq 0$)',
                  mirror_annot)
    
    # Panel 5: Scale I=1
    I_val = np.sqrt(np.sum(pts3**2))
    pts4 = pts3 / I_val
    def scale_annot(ax, pts):
        ax.plot(0, 0, '+', color='#888', markersize=10, markeredgewidth=1.5, zorder=5)
        # Unit circle
        theta = np.linspace(0, 2*np.pi, 100)
        r = 1.0
        ax.plot(r*np.cos(theta), r*np.sin(theta), ':', color='#666', lw=1, alpha=0.6)
        ax.text(0.75, 0.85, '$I = 1$', fontsize=7, color='#666',
                fontweight='bold', style='italic')
    draw_triangle(axes[4], pts4 * 1.5, 'Scale gauge',
                  '5 DOF\n($I = |\\tilde{\\rho}|^2 + |\\tilde{\\lambda}|^2 = 1$)',
                  scale_annot)
    
    # Arrows between panels
    for i in range(4):
        fig.text((i + 1) * 0.19 + 0.02, 0.45, '→', fontsize=18, ha='center',
                 va='center', color='#888', fontweight='bold',
                 transform=fig.transFigure)
    
    fig.savefig(os.path.join(OUT, 'symmetry_cascade.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.12)
    plt.close(fig)
    print("  -> symmetry_cascade.png")


# ============================================================
# 2. HYPERSPHERICAL JACOBI (improved)
# ============================================================
def gen_hyperspherical_jacobi():
    fig, axes = plt.subplots(1, 3, figsize=(11, 4),
                             gridspec_kw={'width_ratios': [1, 1, 1.2]})
    
    # Panel 1: Physical configuration with Jacobi vectors
    ax = axes[0]
    ax.set_xlim(-0.6, 1.6)
    ax.set_ylim(-0.4, 1.4)
    ax.set_aspect('equal')
    ax.axis('off')
    ax.set_title('Physical Jacobi vectors', fontsize=9, fontweight='bold')
    
    # Three bodies
    r = np.array([[0, 0], [1.0, 0], [0.2, 1.0]])
    labels = ['$m_1$', '$m_2$', '$m_3$']
    colors = ['#cc4444', '#2266aa', '#228833']
    
    # Triangle
    tri = np.vstack([r, r[0]])
    ax.plot(tri[:, 0], tri[:, 1], '-', color='#aaa', lw=1)
    ax.fill(r[:, 0], r[:, 1], alpha=0.06, color='#4488cc')
    
    for i in range(3):
        ax.plot(r[i, 0], r[i, 1], 'o', markersize=[10, 8, 6][i],
                color=colors[i], markeredgecolor='#333', lw=0.8, zorder=10)
        offset = [(-0.12, -0.12), (0.08, -0.12), (-0.15, 0.08)]
        ax.text(r[i, 0] + offset[i][0], r[i, 1] + offset[i][1],
                labels[i], fontsize=8, color=colors[i], fontweight='bold')
    
    # rho = r2 - r1
    ax.annotate('', xy=r[1], xytext=r[0],
                arrowprops=dict(arrowstyle='->', color='#cc4444', lw=2.5))
    ax.text(0.5, -0.15, '$\\boldsymbol{\\rho}$', fontsize=11, ha='center',
            color='#cc4444', fontweight='bold')
    
    # com of pair 1-2
    com12 = 0.4 * r[0] + 0.6 * r[1]  # rough
    ax.plot(com12[0], com12[1], 'x', color='#888', markersize=6, markeredgewidth=1.5)
    ax.text(com12[0], com12[1] - 0.1, 'com$_{12}$', fontsize=6, color='#888', ha='center')
    
    # lambda = r3 - com12
    ax.annotate('', xy=r[2], xytext=com12,
                arrowprops=dict(arrowstyle='->', color='#2266aa', lw=2.5))
    ax.text(com12[0] - 0.2, (com12[1] + r[2, 1])/2 + 0.05,
            '$\\boldsymbol{\\lambda}$', fontsize=11, color='#2266aa', fontweight='bold')
    
    # Panel 2: Mass-weighted in canonical frame
    ax2 = axes[1]
    ax2.set_xlim(-0.3, 1.8)
    ax2.set_ylim(-0.3, 1.5)
    ax2.set_aspect('equal')
    ax2.axis('off')
    ax2.set_title('Mass-weighted, canonical frame', fontsize=9, fontweight='bold')
    
    # rho_tilde along +x
    alpha_val = 0.55
    rho_mag = np.cos(alpha_val)
    lam_mag = np.sin(alpha_val)
    beta_val = 0.8
    
    rho_end = np.array([rho_mag, 0])
    lam_end = np.array([lam_mag * np.cos(beta_val), lam_mag * np.sin(beta_val)])
    
    # Origin
    ax2.plot(0, 0, 'ko', markersize=4, zorder=10)
    
    # Rho tilde
    ax2.annotate('', xy=rho_end, xytext=[0, 0],
                arrowprops=dict(arrowstyle='->', color='#cc4444', lw=2.5))
    ax2.text(rho_mag/2, -0.12, '$\\tilde{\\rho} = \\cos\\alpha$',
             fontsize=8, ha='center', color='#cc4444', fontweight='bold')
    
    # Lambda tilde
    ax2.annotate('', xy=lam_end, xytext=[0, 0],
                arrowprops=dict(arrowstyle='->', color='#2266aa', lw=2.5))
    ax2.text(lam_end[0] - 0.15, lam_end[1] + 0.08,
             '$\\tilde{\\lambda} = \\sin\\alpha$',
             fontsize=8, color='#2266aa', fontweight='bold')
    
    # Alpha arc
    theta_a = np.linspace(0, alpha_val, 40)
    r_a = 0.4
    ax2.plot(r_a * np.cos(theta_a), r_a * np.sin(theta_a), '-', color='#888', lw=1.5)
    ax2.text(0.42, 0.15, '$\\alpha$', fontsize=11, color='#888', fontweight='bold')
    
    # Beta arc
    theta_b = np.linspace(0, beta_val, 40)
    r_b = 0.25
    ax2.plot(r_b * np.cos(theta_b), r_b * np.sin(theta_b), '-', color='#228833', lw=1.5)
    ax2.text(0.22, 0.1, '$\\beta$', fontsize=10, color='#228833', fontweight='bold')
    
    # Unit circle (I=1)
    theta_c = np.linspace(0, np.pi/2, 50)
    ax2.plot(np.cos(theta_c), np.sin(theta_c), ':', color='#999', lw=1)
    ax2.text(0.55, 0.85, '$|\\tilde{\\rho}|^2 + |\\tilde{\\lambda}|^2 = 1$',
             fontsize=7, color='#999', style='italic')
    
    # Panel 3: Alpha sweep showing different shapes
    ax3 = axes[2]
    ax3.set_xlim(-0.3, 3.8)
    ax3.set_ylim(-0.5, 2.8)
    ax3.set_aspect('equal')
    ax3.axis('off')
    ax3.set_title('Effect of $\\alpha$ on triangle shape', fontsize=9, fontweight='bold')
    
    alphas = [0.15, 0.45, 0.78, 1.2]
    beta_fixed = 0.9
    x_offsets = [0, 1.0, 2.0, 3.0]
    y_offset = 1.3
    
    for i, (alpha, x0) in enumerate(zip(alphas, x_offsets)):
        rho_m = np.cos(alpha)
        lam_m = np.sin(alpha)
        
        # Reconstruct a triangle from Jacobi vectors
        # r1 at origin, r2 along rho, r3 from lambda
        p1 = np.array([x0, y_offset])
        p2 = np.array([x0 + rho_m * 0.7, y_offset])
        lam_vec = lam_m * 0.7 * np.array([np.cos(beta_fixed), np.sin(beta_fixed)])
        com12 = (p1 + p2) / 2
        p3 = com12 + lam_vec
        
        pts = np.array([p1, p2, p3])
        tri = np.vstack([pts, pts[0]])
        ax3.plot(tri[:, 0], tri[:, 1], '-', color='#555', lw=1)
        ax3.fill(pts[:, 0], pts[:, 1], alpha=0.12, color='#4488cc')
        
        for j in range(3):
            ax3.plot(pts[j, 0], pts[j, 1], 'o', markersize=4,
                    color=['#cc4444', '#2266aa', '#228833'][j],
                    markeredgecolor='#333', lw=0.5, zorder=10)
        
        ax3.text(x0 + 0.35, y_offset - 0.4,
                 f'$\\alpha = {alpha:.2f}$', fontsize=6.5, ha='center',
                 fontweight='bold', color='#333')
    
    # Labels
    ax3.text(0.35, 0.3, 'Tight inner pair\n$\\alpha \\approx 0$',
             fontsize=7, ha='center', color='#cc4444',
             bbox=dict(boxstyle='round,pad=0.2', facecolor='#fde8e8', edgecolor='#ddd'))
    ax3.text(3.35, 0.3, 'Comparable scales\n$\\alpha \\approx \\pi/4$',
             fontsize=7, ha='center', color='#2266aa',
             bbox=dict(boxstyle='round,pad=0.2', facecolor='#e8ecfd', edgecolor='#ddd'))
    
    # Arrow showing alpha increasing
    ax3.annotate('', xy=(3.2, 0.85), xytext=(0.5, 0.85),
                arrowprops=dict(arrowstyle='->', color='#888', lw=1.5))
    ax3.text(1.85, 0.95, '$\\alpha$ increases →', fontsize=7.5, ha='center',
             color='#888', fontweight='bold')
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'hyperspherical_jacobi.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.12)
    plt.close(fig)
    print("  -> hyperspherical_jacobi.png")


# ============================================================
# 3. LINEARISED DECODER (new)
# ============================================================
def gen_linearised_decoder():
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    
    # Left: full decoder precision loss
    ax = axes[0]
    ax.set_title('Full decoder at deep zoom', fontsize=10, fontweight='bold')
    
    depths = np.arange(0, 55)
    # Tile width in UV space
    tile_width = 2.0**(-depths)
    # f32 precision: ~7 decimal digits
    f32_eps = 1.2e-7
    # Usable precision: ratio of tile width to absolute position precision
    # At depth d, the tile centre is O(1) but width is 2^-d
    # f32 can resolve ~eps relative, so within-tile resolution is eps/tile_width
    usable_bits_full = np.log2(tile_width / f32_eps)
    usable_bits_full = np.clip(usable_bits_full, 0, 23)
    
    # Linearised: precision is always full f32 within tile
    usable_bits_lin = np.full_like(depths, 23.0, dtype=float)
    
    ax.plot(depths, usable_bits_full, '-', color='#cc4444', lw=2, label='Full nonlinear decoder')
    ax.plot(depths, usable_bits_lin, '--', color='#228833', lw=2, label='Linearised decoder')
    ax.axhline(0, color='#888', lw=0.5, ls=':')
    
    # Mark switchover
    switch = 20
    ax.axvline(switch, color='#2266aa', lw=1.5, ls='--', alpha=0.7)
    ax.text(switch + 0.5, 18, f'$\\ell_{{switch}} = {switch}$\n(default)', fontsize=8,
            color='#2266aa', fontweight='bold')
    
    # Mark where full decoder hits floor
    floor_depth = np.argmax(usable_bits_full <= 1)
    ax.annotate('f32 floor\n(samples identical)', xy=(floor_depth, 1),
                xytext=(floor_depth + 5, 6),
                fontsize=7.5, color='#cc4444', fontweight='bold',
                arrowprops=dict(arrowstyle='->', color='#cc4444', lw=1))
    
    ax.set_xlabel('Quadtree depth $\\ell$', fontsize=9)
    ax.set_ylabel('Usable bits of within-tile precision', fontsize=9)
    ax.legend(fontsize=8)
    ax.set_xlim(0, 54)
    ax.set_ylim(-1, 25)
    ax.grid(True, alpha=0.2)
    
    # Right: schematic of the linearisation
    ax2 = axes[1]
    ax2.set_xlim(-0.5, 6)
    ax2.set_ylim(-0.5, 5)
    ax2.axis('off')
    ax2.set_title('Linearised decode principle', fontsize=10, fontweight='bold')
    
    # CPU box
    box = FancyBboxPatch((0.2, 3.2), 2.5, 1.5, boxstyle="round,pad=0.1",
                         facecolor='#dbe9f7', edgecolor='#2266aa', lw=1.5)
    ax2.add_patch(box)
    ax2.text(1.45, 4.4, 'CPU (f64)', fontsize=9, ha='center', fontweight='bold', color='#2266aa')
    ax2.text(1.45, 3.9, '$x_0 = D(c_u, c_v)$', fontsize=8, ha='center', fontfamily='monospace')
    ax2.text(1.45, 3.5, '$J_D = \\partial D / \\partial(u,v)$', fontsize=8, ha='center')
    
    # Arrow down
    ax2.annotate('', xy=(1.45, 2.8), xytext=(1.45, 3.15),
                arrowprops=dict(arrowstyle='->', color='#555', lw=1.5))
    ax2.text(2.2, 2.95, 'cast to f32', fontsize=7, color='#888', style='italic')
    
    # GPU box
    box2 = FancyBboxPatch((0.2, 1.0), 2.5, 1.7, boxstyle="round,pad=0.1",
                          facecolor='#d4edda', edgecolor='#228833', lw=1.5)
    ax2.add_patch(box2)
    ax2.text(1.45, 2.35, 'GPU shader (f32)', fontsize=9, ha='center',
             fontweight='bold', color='#228833')
    ax2.text(1.45, 1.85, '$x(t_u, t_v) = x_0 + J_D \\cdot \\delta$', fontsize=9, ha='center')
    ax2.text(1.45, 1.35, '$\\delta = (h_u(2t_u-1),\\; h_v(2t_v-1))$', fontsize=7.5, ha='center',
             color='#555')
    
    # Annotation: why this works
    box3 = FancyBboxPatch((3.3, 1.5), 2.4, 2.8, boxstyle="round,pad=0.15",
                          facecolor='#f8f8f8', edgecolor='#ccc', lw=1)
    ax2.add_patch(box3)
    ax2.text(4.5, 3.9, 'Why this works:', fontsize=8, ha='center', fontweight='bold')
    ax2.text(4.5, 3.4, '• $x_0$ has full f64 precision\n  (computed on CPU)',
             fontsize=7, ha='center', color='#333')
    ax2.text(4.5, 2.7, '• $J_D \\cdot \\delta$ is O($h$) — small,\n  well within f32 range',
             fontsize=7, ha='center', color='#333')
    ax2.text(4.5, 2.0, '• Error is O($h^2$) ≈ $10^{-18}$\n  at depth 30',
             fontsize=7, ha='center', color='#333')
    ax2.text(4.5, 1.4, '• No sigmoid/softmax/trig\n  → faster per sample too',
             fontsize=7, ha='center', color='#228833')
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'linearised_decoder.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.12)
    plt.close(fig)
    print("  -> linearised_decoder.png")


# ============================================================
# 4. KDK LEAPFROG STRUCTURE (new)
# ============================================================
def gen_kdk_leapfrog():
    fig, ax = plt.subplots(1, 1, figsize=(9, 3.5))
    ax.set_xlim(-0.5, 9.5)
    ax.set_ylim(-1.0, 3.5)
    ax.axis('off')
    ax.set_title('KDK Leapfrog: Kick–Drift–Kick Structure', fontsize=11, fontweight='bold', pad=10)
    
    # Timeline
    y_time = 2.0
    ax.plot([0.5, 8.5], [y_time, y_time], '-', color='#888', lw=1)
    
    # Time markers
    times = [1.0, 4.5, 8.0]
    labels_t = ['$t$', '$t + \\Delta t/2$', '$t + \\Delta t$']
    for t, label in zip(times, labels_t):
        ax.plot(t, y_time, '|', color='#333', markersize=12, markeredgewidth=2)
        ax.text(t, y_time - 0.25, label, ha='center', fontsize=8, color='#333')
    
    # Kick 1 (half step)
    kick_color = '#cc4444'
    drift_color = '#2266aa'
    
    # Kick 1
    ax.annotate('', xy=(2.7, y_time + 0.6), xytext=(1.0, y_time + 0.6),
                arrowprops=dict(arrowstyle='->', color=kick_color, lw=2.5))
    ax.text(1.85, y_time + 0.8, 'KICK $\\frac{\\Delta t}{2}$',
            fontsize=9, ha='center', color=kick_color, fontweight='bold')
    ax.text(1.85, y_time + 1.25, '$p_i \\leftarrow p_i + \\frac{\\Delta t}{2} F_i(r)$',
            fontsize=8, ha='center', color=kick_color, fontfamily='monospace')
    
    # Drift
    ax.annotate('', xy=(5.8, y_time + 0.6), xytext=(2.7, y_time + 0.6),
                arrowprops=dict(arrowstyle='->', color=drift_color, lw=2.5))
    ax.text(4.25, y_time + 0.8, 'DRIFT $\\Delta t$',
            fontsize=9, ha='center', color=drift_color, fontweight='bold')
    ax.text(4.25, y_time + 1.25, '$r_i \\leftarrow r_i + \\Delta t \\, p_i / m_i$',
            fontsize=8, ha='center', color=drift_color, fontfamily='monospace')
    
    # Kick 2
    ax.annotate('', xy=(8.0, y_time + 0.6), xytext=(5.8, y_time + 0.6),
                arrowprops=dict(arrowstyle='->', color=kick_color, lw=2.5))
    ax.text(6.9, y_time + 0.8, 'KICK $\\frac{\\Delta t}{2}$',
            fontsize=9, ha='center', color=kick_color, fontweight='bold')
    ax.text(6.9, y_time + 1.25, '$p_i \\leftarrow p_i + \\frac{\\Delta t}{2} F_i(r)$',
            fontsize=8, ha='center', color=kick_color, fontfamily='monospace')
    
    # Post-step operations
    y_post = 0.3
    ax.plot([8.0, 8.0], [y_time - 0.1, y_post + 0.5], ':', color='#888', lw=1)
    
    box = FancyBboxPatch((5.5, y_post - 0.3), 3.5, 0.7, boxstyle="round,pad=0.08",
                         facecolor='#f0e6ff', edgecolor='#7744aa', lw=1.2)
    ax.add_patch(box)
    ax.text(7.25, y_post + 0.25, 'Post-step:', fontsize=7.5, ha='center',
            fontweight='bold', color='#7744aa')
    ax.text(7.25, y_post - 0.05, 'COM projection → Invariant accumulation → Event check',
            fontsize=6.5, ha='center', color='#7744aa')
    
    # Symplectic annotation
    ax.text(0.5, 0.0, 'Symplectic: phase-space volume\npreserved exactly per step.\nEnergy bounded, not drifting.',
            fontsize=7, color='#666',
            bbox=dict(boxstyle='round,pad=0.25', facecolor='#f8f8f8', edgecolor='#ddd'))
    
    fig.savefig(os.path.join(OUT, 'kdk_leapfrog.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.12)
    plt.close(fig)
    print("  -> kdk_leapfrog.png")


# ============================================================
# 5. ADAPTIVE SUBSTEPPING (new)
# ============================================================
def gen_adaptive_substepping():
    fig, axes = plt.subplots(2, 1, figsize=(8, 4.5),
                             gridspec_kw={'height_ratios': [1.2, 1]}, sharex=True)
    
    # Simulate a close encounter
    t = np.linspace(0, 10, 500)
    
    # r_min: bodies approach, get close, then separate
    r_min = 0.5 + 0.45 * np.cos(t * 0.7) - 0.3 * np.exp(-((t - 5)**2) / 0.5)
    r_min = np.clip(r_min, 0.01, 2.0)
    
    # Substep count: N_sub = min(N_max, max(1, ceil((r_sub/r_min)^gamma)))
    r_sub = 0.05
    gamma_sub = 1.5
    N_max = 64
    N_sub = np.minimum(N_max, np.maximum(1, np.ceil((r_sub / r_min)**gamma_sub)))
    
    # Top: r_min
    ax = axes[0]
    ax.plot(t, r_min, '-', color='#2266aa', lw=1.5, label='$r_{\\min}(t)$')
    ax.axhline(r_sub, color='#cc4444', ls='--', lw=1, label=f'$r_{{sub}} = {r_sub}$')
    ax.set_ylabel('$r_{\\min}$ (closest pair)', fontsize=9)
    ax.set_title('Adaptive Substepping Near Close Encounters', fontsize=11, fontweight='bold')
    ax.legend(fontsize=8, loc='upper right')
    ax.grid(True, alpha=0.2)
    ax.set_yscale('log')
    ax.set_ylim(0.005, 2)
    
    # Shade the close encounter region
    close_mask = r_min < 0.1
    if np.any(close_mask):
        ax.fill_between(t, 0.005, 2, where=close_mask, alpha=0.08, color='#cc4444')
        # Find centre of close encounter
        ce_centre = t[np.argmin(r_min)]
        ax.text(ce_centre, 1.2, 'close\nencounter', fontsize=7, ha='center',
                color='#cc4444', style='italic', fontweight='bold')
    
    # Bottom: N_sub
    ax2 = axes[1]
    ax2.fill_between(t, N_sub, alpha=0.3, color='#cc8800', step='mid')
    ax2.plot(t, N_sub, drawstyle='steps-mid', color='#cc8800', lw=1.2)
    ax2.axhline(N_max, color='#cc4444', ls='--', lw=1, label=f'$N_{{max}} = {N_max}$')
    ax2.axhline(1, color='#228833', ls=':', lw=1, label='$N_{sub} = 1$ (no substepping)')
    
    ax2.set_xlabel('Integration time $t$', fontsize=9)
    ax2.set_ylabel('$N_{sub}$ (substeps per macro-step)', fontsize=9)
    ax2.legend(fontsize=7, loc='upper right')
    ax2.grid(True, alpha=0.2)
    ax2.set_yscale('log')
    ax2.set_ylim(0.7, 100)
    
    # Formula annotation
    ax2.text(0.5, 40, '$N_{sub} = \\min\\left(N_{max},\\; \\lceil (r_{sub}/r_{min})^{\\gamma_{sub}} \\rceil\\right)$',
             fontsize=9, fontweight='bold', color='#333',
             bbox=dict(boxstyle='round,pad=0.3', facecolor='#fff3cd', edgecolor='#888'))
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'adaptive_substepping.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.1)
    plt.close(fig)
    print("  -> adaptive_substepping.png")


# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    print("Generating improved + new diagrams...")
    gen_symmetry_cascade()
    gen_hyperspherical_jacobi()
    gen_linearised_decoder()
    gen_kdk_leapfrog()
    gen_adaptive_substepping()
    print("Done.")
