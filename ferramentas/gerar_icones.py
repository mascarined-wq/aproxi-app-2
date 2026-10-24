"""Gera os ícones do Aproxi: fundo azul-caneta, letra A branca e traço de marca-texto."""
import sys
from PIL import Image, ImageDraw

DESTINO = sys.argv[1]
AZUL = (42, 68, 212)
BRANCO = (255, 255, 255)
MARCA = (255, 228, 92)


def desenhar(tamanho, escala_letra, cantos):
    s = 1024  # desenha grande e reduz, para as bordas ficarem lisas
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if cantos:
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=AZUL)
    else:
        d.rectangle((0, 0, s, s), fill=AZUL)

    cx, cy = s / 2, s / 2 + s * 0.02
    meia_base = s * 0.20 * escala_letra
    altura = s * 0.52 * escala_letra
    topo = (cx, cy - altura / 2)
    esq = (cx - meia_base, cy + altura / 2)
    dir_ = (cx + meia_base, cy + altura / 2)
    grossura = int(s * 0.085 * escala_letra)

    def traco(a, b, cor, g):
        d.line([a, b], fill=cor, width=g)
        for p in (a, b):
            d.ellipse((p[0] - g / 2, p[1] - g / 2, p[0] + g / 2, p[1] + g / 2), fill=cor)

    traco(esq, topo, BRANCO, grossura)
    traco(topo, dir_, BRANCO, grossura)
    # o traço de marca-texto no lugar da barra do A
    y = cy + altura * 0.12
    t = (y - topo[1]) / (esq[1] - topo[1])
    x_esq = topo[0] + (esq[0] - topo[0]) * t
    x_dir = topo[0] + (dir_[0] - topo[0]) * t
    traco((x_esq + grossura * 0.2, y), (x_dir - grossura * 0.2, y), MARCA, int(grossura * 0.95))
    return img.resize((tamanho, tamanho), Image.LANCZOS)


desenhar(192, 1.0, True).save(f"{DESTINO}/icon-192.png")
desenhar(512, 1.0, True).save(f"{DESTINO}/icon-512.png")
desenhar(512, 0.78, False).save(f"{DESTINO}/icon-maskable-512.png")   # área segura do Android
desenhar(180, 0.9, False).save(f"{DESTINO}/apple-touch-icon.png")     # o iPhone arredonda sozinho
print("ícones gerados")
