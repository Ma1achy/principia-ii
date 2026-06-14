"""
Generate architectural and explanatory diagrams for the Principia spec.
"""

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Arc
from matplotlib.collections import PatchCollection
import matplotlib.patheffects as pe
import os

OUT = "/home/claude"
DPI = 200

# ============================================================
# 1. DATA FLOW DIAGRAMS (one per layer)
# ============================================================

def _box(ax, x, y, w, h, text, color='#e8e8e8', edgecolor='#333',
         fontsize=9, bold=False, textcolor='#111'):
    box = FancyBboxPatch((x - w/2, y - h/2), w, h,
                         boxstyle="round,pad=0.08", facecolor=color,
                         edgecolor=edgecolor, linewidth=1.5)
    ax.add_patch(box)
    weight = 'bold' if bold else 'normal'
    ax.text(x, y, text, ha='center', va='center', fontsize=fontsize,
            fontweight=weight, color=textcolor)

def _arrow(ax, x1, y1, x2, y2, label='', color='#555', lw=1.5, fontsize=7):
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle='->', color=color, lw=lw))
    if label:
        mx, my = (x1+x2)/2, (y1+y2)/2
        ax.text(mx, my + 0.15, label, ha='center', va='bottom',
                fontsize=fontsize, color=color, style='italic')

def gen_dataflow_layer0():
    fig, ax = plt.subplots(1, 1, figsize=(7, 3))
    ax.set_xlim(-0.5, 7)
    ax.set_ylim(-0.5, 3)
    ax.axis('off')
    ax.set_title('Layer 0: Flat Grid — Data Flow', fontsize=11, fontweight='bold', pad=10)

    # CPU side
    _box(ax, 1.0, 2.0, 1.8, 0.7, 'CPU\nDerive uniforms\nfrom grid position', '#dbe9f7', bold=True)
    # Arrow CPU -> GPU
    _arrow(ax, 2.0, 2.0, 3.2, 2.0, 'tile uniforms\n+ SimUniforms', '#2266aa')
    # GPU compute
    _box(ax, 4.5, 2.0, 2.0, 0.7, 'GPU Compute\nDecode → Integrate\n→ Write SimResult', '#d4edda', bold=True)
    # Arrow compute -> render
    _arrow(ax, 5.6, 2.0, 6.3, 2.0, '', '#228833')
    # GPU render  
    _box(ax, 7.2, 2.0, 1.4, 0.7, 'GPU Fragment\nRead SimResult\n→ Colour pixel', '#d4edda')
    
    # "stays on GPU" annotation
    ax.annotate('', xy=(7.2, 1.2), xytext=(4.5, 1.2),
                arrowprops=dict(arrowstyle='<->', color='#228833', lw=1.2, ls='--'))
    ax.text(5.85, 0.95, 'SimResult stays on GPU', ha='center', fontsize=7,
            color='#228833', style='italic')

    # No GPU->CPU
    ax.text(3.5, 0.4, 'GPU → CPU: nothing', ha='center', fontsize=8,
            color='#aa3333', fontweight='bold',
            bbox=dict(boxstyle='round,pad=0.3', facecolor='#fde8e8', edgecolor='#aa3333', lw=1))

    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'dataflow_layer0.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.1)
    plt.close(fig)
    print("  -> dataflow_layer0.png")

def gen_dataflow_layer1():
    fig, ax = plt.subplots(1, 1, figsize=(8, 3.5))
    ax.set_xlim(-0.5, 8.5)
    ax.set_ylim(-0.2, 3.5)
    ax.axis('off')
    ax.set_title('Layer 1: Tile Cache + Ancestor Fallback — Data Flow', fontsize=11, fontweight='bold', pad=10)

    # CPU
    _box(ax, 1.2, 2.5, 2.0, 0.7, 'CPU Scheduler\nCache lookup\nAncestor walk', '#dbe9f7', bold=True)
    _arrow(ax, 2.3, 2.5, 3.3, 2.5, 'tile uniforms', '#2266aa')
    
    # GPU compute
    _box(ax, 4.5, 2.5, 1.8, 0.7, 'GPU Compute\nDecode → Integrate\n→ SimResult', '#d4edda', bold=True)
    
    # Cache
    _box(ax, 4.5, 1.2, 1.8, 0.6, 'GPU Tile Cache\nMap<(z,tx,ty), Buf>', '#fff3cd')
    _arrow(ax, 4.5, 2.1, 4.5, 1.55, '', '#888')
    
    # Render
    _arrow(ax, 5.5, 1.2, 6.2, 1.2, '', '#228833')
    _box(ax, 7.2, 1.2, 1.6, 0.6, 'GPU Fragment\nRead from\ncache hit', '#d4edda')

    # No GPU->CPU
    ax.text(4.0, 0.15, 'GPU → CPU: nothing (cache membership is CPU-side boolean)',
            ha='center', fontsize=7.5, color='#aa3333', fontweight='bold',
            bbox=dict(boxstyle='round,pad=0.3', facecolor='#fde8e8', edgecolor='#aa3333', lw=1))

    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'dataflow_layer1.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.15)
    plt.close(fig)
    print("  -> dataflow_layer1.png")

def gen_dataflow_layer2():
    fig, ax = plt.subplots(1, 1, figsize=(8.5, 4.2))
    ax.set_xlim(-0.3, 8.8)
    ax.set_ylim(-0.3, 4.2)
    ax.axis('off')
    ax.set_title('Layer 2: Adaptive Refinement — Data Flow', fontsize=11, fontweight='bold', pad=10)

    # CPU scheduler
    _box(ax, 1.2, 3.2, 2.0, 0.7, 'CPU Scheduler\nPriority queue\nSplit decisions', '#dbe9f7', bold=True)
    
    # CPU -> GPU
    _arrow(ax, 2.3, 3.2, 3.3, 3.2, 'TileRequest', '#2266aa')
    
    # GPU compute
    _box(ax, 4.6, 3.2, 2.0, 0.7, 'GPU Compute\nDecode → ICDescriptor\nIntegrate → SimResult', '#d4edda', bold=True)
    
    # GPU reduce
    _box(ax, 4.6, 1.8, 2.0, 0.6, 'GPU Reduction\nSimResult[T²]\n→ TileReduction', '#d4edda')
    _arrow(ax, 4.6, 2.8, 4.6, 2.15, '', '#228833')
    
    # GPU -> CPU (the key new arrow)
    _arrow(ax, 3.5, 1.8, 2.3, 2.85, '~80 bytes\nTileReduction', '#cc4444', lw=2.0, fontsize=8)
    
    # Render path
    _box(ax, 7.6, 3.2, 1.6, 0.6, 'GPU Fragment\nSimResult\n+ ICDescriptor', '#d4edda')
    _arrow(ax, 5.7, 3.2, 6.75, 3.2, 'GPU→GPU', '#228833')
    
    # Annotation
    ax.text(4.2, 0.7, 'TileReduction is the ONLY GPU→CPU data in normal operation',
            ha='center', fontsize=8, color='#cc4444', fontweight='bold',
            bbox=dict(boxstyle='round,pad=0.3', facecolor='#fde8e8', edgecolor='#cc4444', lw=1))

    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'dataflow_layer2.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.15)
    plt.close(fig)
    print("  -> dataflow_layer2.png")


# ============================================================
# 2. QUADTREE ANCESTOR FALLBACK
# ============================================================

def gen_quadtree_fallback():
    fig, axes = plt.subplots(1, 2, figsize=(9, 4))
    
    # Left: quadtree structure
    ax = axes[0]
    ax.set_xlim(-0.3, 4.3)
    ax.set_ylim(-1.1, 3.8)
    ax.axis('off')
    ax.set_title('Quadtree State', fontsize=10, fontweight='bold')
    
    # Root (level 0)
    _box(ax, 2.0, 3.2, 0.6, 0.4, 'R', '#b8d4a8', fontsize=8)
    
    # Level 1: 4 children
    positions_l1 = [(0.5, 2.0), (1.5, 2.0), (2.5, 2.0), (3.5, 2.0)]
    states_l1 = ['#b8d4a8', '#b8d4a8', '#b8d4a8', '#b8d4a8']
    for i, ((px, py), col) in enumerate(zip(positions_l1, states_l1)):
        _box(ax, px, py, 0.5, 0.35, f'L1.{i}', col, fontsize=7)
        ax.plot([2.0, px], [3.0, 2.2], 'k-', lw=0.8)
    
    # Level 2: some children of L1.2 and L1.3
    l2_data = [
        (2.1, 0.8, '#b8d4a8', 'R'),
        (2.6, 0.8, '#fff3a8', 'C'),
        (3.1, 0.8, '#fff3a8', 'C'),
        (3.6, 0.8, '#d4d4d4', 'Q'),
    ]
    for i, (px, py, col, label) in enumerate(l2_data):
        _box(ax, px, py, 0.4, 0.3, label, col, fontsize=7)
        parent_x = 2.5 if i < 2 else 3.5
        ax.plot([parent_x, px], [1.8, 0.95], 'k-', lw=0.6)
    
    # Legend
    for i, (label, color) in enumerate([('Ready', '#b8d4a8'), ('Computing', '#fff3a8'), ('Queued', '#d4d4d4')]):
        ax.add_patch(FancyBboxPatch((0.0, -0.4 - i*0.35), 0.25, 0.22,
                     boxstyle="round,pad=0.02", facecolor=color, edgecolor='#333', lw=0.8))
        ax.text(0.4, -0.28 - i*0.35, label, fontsize=7, va='center')
    
    # Right: screen-space result
    ax2 = axes[1]
    ax2.set_xlim(-0.1, 4.1)
    ax2.set_ylim(-0.1, 4.1)
    ax2.axis('off')
    ax2.set_title('Screen Result', fontsize=10, fontweight='bold')
    
    for (x0, y0) in [(0, 2), (2, 2), (0, 0)]:
        rect = plt.Rectangle((x0, y0), 2, 2, facecolor='#b8d4a8', edgecolor='#333', lw=1.5)
        ax2.add_patch(rect)
        ax2.text(x0+1, y0+1, 'Sharp\n(Ready)', ha='center', va='center', fontsize=7)
    
    l2_screen = [
        (2, 1, '#b8d4a8', 'Sharp'),
        (3, 1, '#e8deb8', 'Blurry\n(fallback)'),
        (2, 0, '#e8deb8', 'Blurry\n(fallback)'),
        (3, 0, '#e8deb8', 'Blurry\n(fallback)'),
    ]
    for (x0, y0, col, label) in l2_screen:
        rect = plt.Rectangle((x0, y0), 1, 1, facecolor=col, edgecolor='#333', lw=1)
        ax2.add_patch(rect)
        ax2.text(x0+0.5, y0+0.5, label, ha='center', va='center', fontsize=6)
    
    fig.tight_layout(w_pad=3.0)
    fig.savefig(os.path.join(OUT, 'quadtree_fallback.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.15)
    plt.close(fig)
    print("  -> quadtree_fallback.png")


# ============================================================
# 3. DECODE PIPELINE
# ============================================================

def gen_decode_pipeline():
    fig, ax = plt.subplots(1, 1, figsize=(8, 2.2))
    ax.set_xlim(-0.5, 10)
    ax.set_ylim(-0.5, 2.5)
    ax.axis('off')
    ax.set_title('Decode Pipeline: Chart Coordinates → Physical IC', fontsize=11, fontweight='bold', pad=8)
    
    stages = [
        (0.6, 'UV\n[0,1]²', '#f0e6ff'),
        (2.2, 'Φ\nChart\nmap', '#e6f0ff'),
        (3.8, 'Y\nDecode\nparams', '#e6f0ff'),
        (5.6, 'D\nDecoder', '#dbe9f7'),
        (7.2, 'C\nCanon-\naliser', '#dbe9f7'),
        (9.0, '(mᵢ, rᵢ, pᵢ)\nPhysical IC', '#d4edda'),
    ]
    
    for i, (x, label, color) in enumerate(stages):
        _box(ax, x, 1.2, 1.2, 1.0, label, color, fontsize=8, bold=(i in [1, 3, 4]))
        if i > 0:
            prev_x = stages[i-1][0]
            _arrow(ax, prev_x + 0.65, 1.2, x - 0.65, 1.2, '', '#555')
    
    # Factorisation annotation below decoder
    ax.text(5.6, 0.1, 'mass × config × momentum', ha='center', fontsize=7,
            style='italic', color='#666',
            bbox=dict(boxstyle='round,pad=0.2', facecolor='#f8f8f8', edgecolor='#ccc'))
    
    # Terminal tag annotation
    ax.annotate('Terminal tag\n(if degenerate)', xy=(7.8, 0.7), xytext=(8.8, 0.2),
                fontsize=6.5, ha='center', color='#aa3333',
                arrowprops=dict(arrowstyle='->', color='#aa3333', lw=0.8))
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'decode_pipeline.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.1)
    plt.close(fig)
    print("  -> decode_pipeline.png")


# ============================================================
# 4. LABELLED SHAPE SPHERE
# ============================================================

def gen_labelled_shape_sphere():
    fig = plt.figure(figsize=(5, 5))
    ax = fig.add_subplot(111, projection='3d')
    
    # Draw transparent sphere wireframe
    u = np.linspace(0, 2*np.pi, 40)
    v = np.linspace(0, np.pi, 20)
    x = np.outer(np.cos(u), np.sin(v))
    y = np.outer(np.sin(u), np.sin(v))
    z = np.outer(np.ones_like(u), np.cos(v))
    ax.plot_surface(x, y, z, alpha=0.08, color='#aaccee', edgecolor='#cccccc', linewidth=0.3)
    
    # BC points (equal mass)
    bc = np.array([
        [1, 0, 0],
        [-0.5, np.sqrt(3)/2, 0],
        [-0.5, -np.sqrt(3)/2, 0]
    ])
    bc_labels = ['BC₁₂\n(1,0,0)', 'BC₂₃\n(-½,√3/2,0)', 'BC₃₁\n(-½,-√3/2,0)']
    for i, (p, label) in enumerate(zip(bc, bc_labels)):
        ax.scatter(*p, s=120, c='red', zorder=10, edgecolors='darkred', linewidth=1)
        ax.text(p[0]*1.25, p[1]*1.25, p[2]+0.05, label, fontsize=6.5,
                ha='center', va='bottom', color='darkred', fontweight='bold')
    
    # Euler points (antipodal to BC on equator)
    euler = -bc
    euler_labels = ['E₁', 'E₂', 'E₃']
    for i, (p, label) in enumerate(zip(euler, euler_labels)):
        ax.scatter(*p, s=60, c='#ff8800', zorder=10, marker='D', edgecolors='#884400', linewidth=0.8)
        ax.text(p[0]*1.2, p[1]*1.2, p[2]-0.12, label, fontsize=7,
                ha='center', va='top', color='#884400', fontweight='bold')
    
    # Lagrange poles
    ax.scatter(0, 0, 1, s=100, c='#00aa44', zorder=10, marker='^', edgecolors='#005522', linewidth=1)
    ax.text(0, 0, 1.15, 'L⁺ (north)', fontsize=7, ha='center', va='bottom', color='#005522', fontweight='bold')
    ax.scatter(0, 0, -1, s=100, c='#00aa44', zorder=10, marker='v', edgecolors='#005522', linewidth=1)
    ax.text(0, 0, -1.2, 'L⁻ (south)', fontsize=7, ha='center', va='top', color='#005522', fontweight='bold')
    
    # Branch cuts: great circle arcs from BC1 and BC2 to north pole
    for i in range(2):
        t = np.linspace(0, 1, 50)
        p0 = bc[i]
        p1 = np.array([0, 0, 1])
        # Slerp
        omega = np.arccos(np.clip(np.dot(p0, p1), -1, 1))
        if omega > 1e-6:
            pts = np.outer(np.sin((1-t)*omega)/np.sin(omega), p0) + \
                  np.outer(np.sin(t*omega)/np.sin(omega), p1)
            ax.plot(pts[:,0], pts[:,1], pts[:,2], '--', color='purple', lw=1.5, alpha=0.8, zorder=5)
    
    ax.text(0.3, 0.15, 0.6, 'Cₐ', fontsize=7, color='purple', fontweight='bold')
    ax.text(-0.4, 0.45, 0.5, 'C_b', fontsize=7, color='purple', fontweight='bold')
    
    # Equator
    theta_eq = np.linspace(0, 2*np.pi, 100)
    ax.plot(np.cos(theta_eq), np.sin(theta_eq), np.zeros_like(theta_eq),
            '-', color='#888888', lw=0.8, alpha=0.5)
    
    ax.set_xlim([-1.3, 1.3])
    ax.set_ylim([-1.3, 1.3])
    ax.set_zlim([-1.3, 1.3])
    ax.set_box_aspect([1, 1, 1])
    ax.axis('off')
    ax.view_init(elev=25, azim=35)
    
    fig.savefig(os.path.join(OUT, 'labelled_shape_sphere.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.05)
    plt.close(fig)
    print("  -> labelled_shape_sphere.png")


# ============================================================
# 5. IC MANIFOLD SLICING
# ============================================================

def gen_ic_slicing():
    fig = plt.figure(figsize=(5, 4))
    ax = fig.add_subplot(111, projection='3d')
    
    # Draw a translucent cube (representing high-D space, projected)
    r = 1.0
    for s in [-r, r]:
        for dim in range(3):
            pts = np.array([[-r,-r], [-r,r], [r,r], [r,-r], [-r,-r]])
            xs, ys = pts[:,0], pts[:,1]
            zs = np.full_like(xs, s)
            if dim == 0:
                ax.plot(zs, xs, ys, '-', color='#bbbbbb', lw=0.5, alpha=0.4)
            elif dim == 1:
                ax.plot(xs, zs, ys, '-', color='#bbbbbb', lw=0.5, alpha=0.4)
            else:
                ax.plot(xs, ys, zs, '-', color='#bbbbbb', lw=0.5, alpha=0.4)
    
    # Draw a 2D plane cutting through
    plane_pts = np.array([[-0.8, -0.8], [-0.8, 0.8], [0.8, 0.8], [0.8, -0.8]])
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    # Tilted plane
    angle = 0.3
    verts = []
    for px, py in plane_pts:
        verts.append([px, py, px*np.sin(angle)*0.3])
    verts = [verts]
    plane = Poly3DCollection(verts, alpha=0.25, facecolor='#4488cc', edgecolor='#2266aa', lw=1.5)
    ax.add_collection3d(plane)
    
    # Lock point
    ax.scatter(0.2, -0.1, 0.2*np.sin(angle)*0.3, s=80, c='red', zorder=10, edgecolors='darkred')
    ax.text(0.2, -0.1, 0.2*np.sin(angle)*0.3 + 0.15, 'z₀ (locked)', fontsize=8,
            ha='center', color='darkred', fontweight='bold')
    
    # Basis vectors q1, q2
    origin = np.array([0.2, -0.1, 0.2*np.sin(angle)*0.3])
    q1 = np.array([0.5, 0, 0.5*np.sin(angle)*0.3])
    q2 = np.array([0, 0.5, 0])
    ax.quiver(*origin, *q1, color='#cc4444', arrow_length_ratio=0.15, lw=2)
    ax.quiver(*origin, *q2, color='#4444cc', arrow_length_ratio=0.15, lw=2)
    ax.text(*(origin + q1 + 0.05), 'q₁', fontsize=9, color='#cc4444', fontweight='bold')
    ax.text(*(origin + q2 + 0.05), 'q₂', fontsize=9, color='#4444cc', fontweight='bold')
    
    # Tilt arrow
    ax.annotate('', xy=(0.75, 0.75), xytext=(0.55, 0.55),
                arrowprops=dict(arrowstyle='->', color='#888', lw=1))
    
    ax.set_xlim([-1.2, 1.2])
    ax.set_ylim([-1.2, 1.2])
    ax.set_zlim([-1.2, 1.2])
    ax.set_box_aspect([1, 1, 1])
    ax.axis('off')
    ax.view_init(elev=20, azim=40)
    ax.set_title('Projective Microscope:\n2D slice through 10D IC space', fontsize=10, fontweight='bold')
    
    fig.savefig(os.path.join(OUT, 'ic_slicing.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.05)
    plt.close(fig)
    print("  -> ic_slicing.png")


# ============================================================
# 6. SIMRESULT MEMORY LAYOUT
# ============================================================

def gen_simresult_layout():
    fig, ax = plt.subplots(1, 1, figsize=(8, 4.5))
    ax.set_xlim(0, 10)
    ax.set_ylim(-0.5, 8)
    ax.axis('off')
    ax.set_title('SimResult Memory Layout (M=8, 208 bytes)', fontsize=11, fontweight='bold', pad=10)
    
    y = 7.0
    fields = [
        ('n_checkpoints[8]', 128, '#c4d9f0', 'float4 × 8 (.xyz=n, .w=phase)'),
        ('free_group_word', 16, '#f0d9c4', 'uint4 (2 bits/symbol, 58 slots)'),
        ('arc_length_n', 4, '#d4edda', 'float'),
        ('t_end', 4, '#d4edda', 'float'),
        ('d_min', 4, '#d4edda', 'float'),
        ('ftle', 4, '#d4edda', 'float'),
        ('energy_drift', 4, '#d4edda', 'float'),
        ('diffusion', 4, '#d4edda', 'float'),
        ('delta_E_max_abs', 4, '#e8d4ed', 'float (new)'),
        ('Lz_drift', 4, '#e8d4ed', 'float (new)'),
        ('delta_Lz_max_abs', 4, '#e8d4ed', 'float (new)'),
        ('E_0', 4, '#e8d4ed', 'float (new)'),
        ('Lz_0', 4, '#e8d4ed', 'float (new)'),
        ('sample_descriptor', 4, '#fff3cd', 'uint32 (bit-packed)'),
        ('trajectory_stats', 4, '#fff3cd', 'uint32 (bit-packed)'),
        ('(padding)', 4, '#e8e8e8', 'alignment to 208'),
    ]
    
    offset = 0
    bar_left = 2.0
    max_width = 7.0
    total_bytes = 208
    
    for name, size, color, desc in fields:
        w = max_width * (size / total_bytes)
        w = max(w, 0.15)
        h = 0.35 if size <= 4 else 0.35
        
        # Compact: group small fields
        rect = plt.Rectangle((bar_left, y - h/2), w * (total_bytes / max(size, 1)) * (size / total_bytes), h,
                              facecolor=color, edgecolor='#333', lw=0.8)
        
        # Actually just do horizontal stacked bars
        bw = max_width * size / total_bytes
        rect = plt.Rectangle((bar_left + max_width * offset / total_bytes, y - h/2),
                              bw, h, facecolor=color, edgecolor='#555', lw=0.6)
        ax.add_patch(rect)
        
        cx = bar_left + max_width * (offset + size/2) / total_bytes
        if size >= 16:
            ax.text(cx, y, f'{name}\n{size}B', ha='center', va='center', fontsize=5.5, fontweight='bold')
        
        offset += size
    
    # Labels below with lines
    y_label = y - 1.0
    label_items = [
        (0, 128, 'Checkpoints (128B)', '#c4d9f0'),
        (128, 16, 'Word (16B)', '#f0d9c4'),
        (144, 24, 'Original floats (24B)', '#d4edda'),
        (168, 20, 'New invariant fields (20B)', '#e8d4ed'),
        (188, 8, 'Packed uints (8B)', '#fff3cd'),
    ]
    
    for i, (off, sz, label, col) in enumerate(label_items):
        cx = bar_left + max_width * (off + sz/2) / total_bytes
        ax.text(cx, y_label - i*0.5, label, ha='center', va='top', fontsize=7,
                bbox=dict(boxstyle='round,pad=0.15', facecolor=col, edgecolor='#999', lw=0.5))
    
    # Bit-packing diagrams for sample_descriptor
    y_bits = 2.5
    ax.text(1.0, y_bits + 0.5, 'sample_descriptor (32 bits)', fontsize=8, fontweight='bold')
    bit_fields = [
        (0, 3, 'class', '#ffcccc'),
        (3, 2, 'detail', '#ffdccc'),
        (5, 1, 'SE', '#ffeccc'),
        (6, 1, 'SL', '#e8d4ed'),
        (7, 1, 'FV', '#ccffcc'),
        (8, 1, 'WT', '#ccffee'),
        (9, 7, 'encounter_count', '#ccddff'),
        (16, 7, 'substep_log2', '#ddccff'),
        (23, 7, 'benettin_count', '#eeccff'),
        (30, 2, 'dp', '#ffccee'),
    ]
    for start, width, label, color in bit_fields:
        bx = 1.0 + start * 0.27
        bw = width * 0.27
        rect = plt.Rectangle((bx, y_bits - 0.2), bw, 0.35, facecolor=color, edgecolor='#555', lw=0.5)
        ax.add_patch(rect)
        ax.text(bx + bw/2, y_bits - 0.02, label, ha='center', va='center', fontsize=4.5, rotation=0)
    
    # trajectory_stats
    y_bits2 = 1.3
    ax.text(1.0, y_bits2 + 0.5, 'trajectory_stats (32 bits)', fontsize=8, fontweight='bold')
    bit_fields2 = [
        (0, 16, 't_dmin_frac', '#ccddff'),
        (16, 7, 'steps_log2', '#ddccff'),
        (23, 6, 'orbit_cnt', '#ccffcc'),
        (29, 2, 'dmin_pr', '#ffcccc'),
        (31, 1, 'R', '#ffccee'),
    ]
    for start, width, label, color in bit_fields2:
        bx = 1.0 + start * 0.27
        bw = width * 0.27
        rect = plt.Rectangle((bx, y_bits2 - 0.2), bw, 0.35, facecolor=color, edgecolor='#555', lw=0.5)
        ax.add_patch(rect)
        ax.text(bx + bw/2, y_bits2 - 0.02, label, ha='center', va='center', fontsize=4.5)
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'simresult_layout.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.1)
    plt.close(fig)
    print("  -> simresult_layout.png")


# ============================================================
# 7. BURRAU FAMILY GEOMETRY
# ============================================================

def gen_burrau_triangles():
    fig, axes = plt.subplots(1, 4, figsize=(9, 2.8))
    fig.suptitle('Burrau–Pythagorean Family: Primitive Triples at Unit Hypotenuse',
                 fontsize=10, fontweight='bold', y=1.02)
    
    triples = [
        (3, 4, 5, 2, 1),
        (5, 12, 13, 3, 2),
        (7, 24, 25, 4, 3),
        (8, 15, 17, 4, 1),
    ]
    
    for idx, (a, b, c, m, n) in enumerate(triples):
        ax = axes[idx]
        # Normalise by hypotenuse
        an, bn = a/c, b/c
        
        # Triangle vertices: right angle at origin
        verts = np.array([[0, 0], [an, 0], [0, bn], [0, 0]])
        ax.plot(verts[:, 0], verts[:, 1], 'k-', lw=1.5)
        ax.fill(verts[:-1, 0], verts[:-1, 1], alpha=0.15, color='#4488cc')
        
        # Masses at vertices (Burrau: mass = opposite side / perimeter)
        perimeter = a + b + c
        masses = [c/perimeter, b/perimeter, a/perimeter]
        positions = np.array([[0, 0], [an, 0], [0, bn]])
        labels_m = [f'm₁={c}/{a+b+c}', f'm₂={b}/{a+b+c}', f'm₃={a}/{a+b+c}']
        
        for i, (pos, mass, label) in enumerate(zip(positions, masses, labels_m)):
            ax.plot(pos[0], pos[1], 'o', markersize=4 + mass*15, color='#cc4444',
                    markeredgecolor='#882222', markeredgewidth=0.8)
        
        # Jacobi vectors
        rho = positions[1] - positions[0]  # r2 - r1
        m01 = masses[0] + masses[1]
        com01 = (masses[0]*positions[0] + masses[1]*positions[1]) / m01
        lam = positions[2] - com01
        
        ax.annotate('', xy=positions[1], xytext=positions[0],
                    arrowprops=dict(arrowstyle='->', color='#cc4444', lw=1.5))
        ax.text(an/2, -0.08, 'ρ₁', fontsize=8, ha='center', color='#cc4444', fontweight='bold')
        
        ax.annotate('', xy=positions[2], xytext=com01,
                    arrowprops=dict(arrowstyle='->', color='#4444cc', lw=1.5))
        ax.text(-0.1, bn/2, 'ρ₂', fontsize=8, ha='center', color='#4444cc', fontweight='bold')
        
        # Right angle marker
        sq_size = 0.04
        ax.plot([sq_size, sq_size, 0], [0, sq_size, sq_size], 'k-', lw=0.8)
        
        ax.set_xlim(-0.15, max(an, bn) + 0.15)
        ax.set_ylim(-0.15, max(an, bn) + 0.15)
        ax.set_aspect('equal')
        ax.set_title(f'({a},{b},{c})\nm={m}, n={n}, ν={n/m:.2f}', fontsize=8)
        ax.axis('off')
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'burrau_triangles.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.1)
    plt.close(fig)
    print("  -> burrau_triangles.png")


# ============================================================
# 8. SPLIT DECISION FLOWCHART
# ============================================================

def gen_split_flowchart():
    fig, ax = plt.subplots(1, 1, figsize=(6, 7))
    ax.set_xlim(-0.5, 6)
    ax.set_ylim(-0.5, 8.5)
    ax.axis('off')
    ax.set_title('Split / Keep / Merge Decision Logic', fontsize=11, fontweight='bold', pad=10)
    
    # Decision diamonds and action boxes
    def diamond(ax, x, y, text, color='#fff3cd'):
        pts = np.array([[x, y+0.4], [x+1.0, y], [x, y-0.4], [x-1.0, y], [x, y+0.4]])
        ax.fill(pts[:,0], pts[:,1], color=color, edgecolor='#555', lw=1.2)
        ax.text(x, y, text, ha='center', va='center', fontsize=7, fontweight='bold')
    
    def action(ax, x, y, text, color='#d4edda'):
        _box(ax, x, y, 1.6, 0.5, text, color, fontsize=8, bold=True)
    
    def yn_arrow(ax, x1, y1, x2, y2, label):
        _arrow(ax, x1, y1, x2, y2, '', '#555', lw=1.2)
        mx, my = (x1+x2)/2, (y1+y2)/2
        ax.text(mx + 0.12, my + 0.05, label, fontsize=6.5, color='#228833', fontweight='bold')
    
    # Flow
    y = 8.0
    diamond(ax, 3.0, y, 'AT_F32_FLOOR?')
    action(ax, 5.2, y, 'STOP\n(resolution floor)', '#fde8e8')
    yn_arrow(ax, 4.0, y, 4.4, y, 'Y')
    
    y -= 1.2
    diamond(ax, 3.0, y, 'At MAX_DEPTH?')
    action(ax, 5.2, y, 'STOP', '#fde8e8')
    yn_arrow(ax, 4.0, y, 4.4, y, 'Y')
    _arrow(ax, 3.0, 7.6, 3.0, 7.2, 'N', '#555')
    
    y -= 1.2
    diamond(ax, 3.0, y, 'Off screen?')
    action(ax, 5.2, y, 'DEPRIORITISE', '#e8e8e8')
    yn_arrow(ax, 4.0, y, 4.4, y, 'Y')
    _arrow(ax, 3.0, 6.4, 3.0, 6.0, 'N', '#555')
    
    y -= 1.2
    diamond(ax, 3.0, y, 'Impurity > 0.10?')
    action(ax, 5.2, y, 'FORCE SPLIT', '#c4d9f0')
    yn_arrow(ax, 4.0, y, 4.4, y, 'Y')
    _arrow(ax, 3.0, 5.2, 3.0, 4.8, 'N', '#555')
    
    y -= 1.2
    diamond(ax, 3.0, y, 'Suspect > 0.05?')
    action(ax, 5.2, y, 'FORCE SPLIT', '#c4d9f0')
    yn_arrow(ax, 4.0, y, 4.4, y, 'Y')
    _arrow(ax, 3.0, 4.0, 3.0, 3.6, 'N', '#555')
    
    y -= 1.2
    diamond(ax, 3.0, y, 'S_tile > τ(ℓ)?')
    action(ax, 5.2, y, 'SPLIT', '#c4d9f0')
    yn_arrow(ax, 4.0, y, 4.4, y, 'Y')
    _arrow(ax, 3.0, 2.8, 3.0, 2.4, 'N', '#555')
    
    y -= 1.2
    diamond(ax, 3.0, y, 'Overresolved?')
    action(ax, 5.2, y, 'MERGE /\nDEPRIORITISE', '#e8e8e8')
    yn_arrow(ax, 4.0, y, 4.4, y, 'Y')
    _arrow(ax, 3.0, 1.6, 3.0, 1.0, 'N', '#555')
    
    action(ax, 3.0, 0.7, 'KEEP', '#d4edda')
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'split_flowchart.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.1)
    plt.close(fig)
    print("  -> split_flowchart.png")


# ============================================================
# 9. RENDER GRAPH PIPELINE
# ============================================================

def gen_render_pipeline():
    fig, ax = plt.subplots(1, 1, figsize=(9, 3.5))
    ax.set_xlim(-0.3, 9.5)
    ax.set_ylim(-1.0, 4.0)
    ax.axis('off')
    ax.set_title('Render Graph Pipeline', fontsize=11, fontweight='bold', pad=10)
    
    # Main pipeline stages
    stages = [
        (0.8, 2.5, 'SimResult\n+ ICDescriptor', '#f0e6ff', False),
        (2.8, 2.5, 'Colour\nNode', '#c4d9f0', True),
        (4.8, 2.5, 'Brightness\nNode', '#c4d9f0', True),
        (6.5, 2.5, 'Combiner', '#d4edda', True),
        (8.2, 2.5, 'Postprocess', '#d4edda', True),
    ]
    
    for x, y, label, color, bold in stages:
        _box(ax, x, y, 1.4, 0.7, label, color, fontsize=8, bold=bold)
    
    for i in range(len(stages)-1):
        x1 = stages[i][0] + 0.75
        x2 = stages[i+1][0] - 0.75
        _arrow(ax, x1, 2.5, x2, 2.5, '', '#555')
    
    # Annotations: vec3 rgb, f32, vec3, vec3
    labels_between = ['', 'vec3\nRGB', 'f32', 'vec3\nRGB', 'vec3\n→ screen']
    for i in range(1, len(stages)):
        mx = (stages[i-1][0] + stages[i][0]) / 2
        ax.text(mx, 3.1, labels_between[i], ha='center', va='bottom', fontsize=6, color='#666', style='italic')
    
    # Colour node options
    colour_opts = ['Basin / Event', 'Shape Sphere', 'Stability×Hue',
                   'ENERGY', 'JACOBI_RATIO', 'ESCAPE_TIME', 'Custom...']
    for i, opt in enumerate(colour_opts):
        ax.text(2.8, 1.7 - i*0.3, '• ' + opt, fontsize=5.5, ha='center', va='top', color='#336')
    
    # Brightness node options
    bright_opts = ['Fixed', 'Event Time', 'Diffusion', 'FTLE', 'Custom...']
    for i, opt in enumerate(bright_opts):
        ax.text(4.8, 1.7 - i*0.3, '• ' + opt, fontsize=5.5, ha='center', va='top', color='#336')
    
    # Combiner modes
    comb_opts = ['Replace L', 'Modulate L', 'Multiply RGB']
    for i, opt in enumerate(comb_opts):
        ax.text(6.5, 1.7 - i*0.3, '• ' + opt, fontsize=5.5, ha='center', va='top', color='#336')
    
    # Post options
    post_opts = ['CVD Preview', 'Debug Overlay', 'Exposure']
    for i, opt in enumerate(post_opts):
        ax.text(8.2, 1.7 - i*0.3, '• ' + opt, fontsize=5.5, ha='center', va='top', color='#336')
    
    # FragmentInfo feeding in
    _box(ax, 0.8, 0.5, 1.2, 0.5, 'FragmentInfo\ntile_uv, world_uv\ntime, playback_τ', '#e8e8e8', fontsize=6)
    _arrow(ax, 0.8, 0.8, 2.2, 2.2, '', '#888', lw=0.8)
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'render_pipeline.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.1)
    plt.close(fig)
    print("  -> render_pipeline.png")


# ============================================================
# 10. PRIORITY HEATMAP
# ============================================================

def gen_priority_heatmap():
    fig, ax = plt.subplots(1, 1, figsize=(4.5, 4.2))
    
    grid_size = 8
    priority = np.zeros((grid_size, grid_size))
    cx, cy = 3.5, 3.5
    
    visible = np.zeros((grid_size, grid_size))
    visible[1:7, 1:7] = 1.0
    
    for i in range(grid_size):
        for j in range(grid_size):
            dist = np.sqrt((i - cx)**2 + (j - cy)**2)
            priority[i, j] = visible[i, j] * (1.0 / (1 + dist * 0.3))
    
    for i in range(grid_size):
        for j in range(grid_size):
            boundary_dist = abs(i - j) / grid_size
            complexity = np.exp(-boundary_dist * 3) * 0.8
            priority[i, j] += visible[i, j] * complexity * 1.5
    
    priority = priority / (priority.max() + 1e-6)
    
    im = ax.imshow(priority, cmap='YlOrRd', interpolation='nearest', origin='lower',
                   vmin=0, vmax=1)
    
    for i in range(grid_size + 1):
        ax.axhline(i - 0.5, color='#333', lw=0.5)
        ax.axvline(i - 0.5, color='#333', lw=0.5)
    
    rect = plt.Rectangle((0.5, 0.5), 6, 6, fill=False, edgecolor='#2266aa', lw=2.5, linestyle='--')
    ax.add_patch(rect)
    ax.text(3.5, 6.7, 'viewport', ha='center', fontsize=8, color='#2266aa', fontweight='bold')
    
    for i in range(grid_size):
        for j in range(grid_size):
            if visible[i, j] == 0:
                ax.text(j, i, '×', ha='center', va='center', fontsize=12, color='#999')
    
    ax.text(2, 2.3, 'fractal\nboundary', ha='center', fontsize=7, color='white',
            fontweight='bold', style='italic')
    
    plt.colorbar(im, ax=ax, label='Priority', shrink=0.75, pad=0.02)
    ax.set_title('Refinement Priority\n(visibility × complexity × focus)', fontsize=9, fontweight='bold')
    ax.set_xticks([])
    ax.set_yticks([])
    
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, 'priority_heatmap.png'), dpi=DPI, bbox_inches='tight',
                facecolor='white', pad_inches=0.1)
    plt.close(fig)
    print("  -> priority_heatmap.png")


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    print("Generating spec diagrams...")
    
    print("\n1. Data flow diagrams")
    gen_dataflow_layer0()
    gen_dataflow_layer1()
    gen_dataflow_layer2()
    
    print("\n2. Quadtree fallback")
    gen_quadtree_fallback()
    
    print("\n3. Decode pipeline")
    gen_decode_pipeline()
    
    print("\n4. Labelled shape sphere")
    gen_labelled_shape_sphere()
    
    print("\n5. IC manifold slicing")
    gen_ic_slicing()
    
    print("\n6. SimResult memory layout")
    gen_simresult_layout()
    
    print("\n7. Burrau triangles")
    gen_burrau_triangles()
    
    print("\n8. Split flowchart")
    gen_split_flowchart()
    
    print("\n9. Render pipeline")
    gen_render_pipeline()
    
    print("\n10. Priority heatmap")
    gen_priority_heatmap()
    
    print("\nDone. All diagrams in", OUT)
