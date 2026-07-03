import { Link } from "react-router-dom";
import { FileText, Download } from "lucide-react";
import type { StorefrontEbook } from "@/lib/storefront";
import { freeDownload } from "@/lib/freeDownload";

interface Props {
  product: StorefrontEbook;
}

export const ProductCard = ({ product }: Props) => {
  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    freeDownload(product.id, product.title);
  };

  return (
    <Link to={`/product/${product.id}`} className="group brutal-card flex flex-col overflow-hidden">
      <div className="relative aspect-[4/5] bg-secondary overflow-hidden border-b-2 border-foreground">
        {product.cover_url ? (
          <img
            src={product.cover_url}
            alt={product.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <FileText className="h-16 w-16" strokeWidth={1.5} />
          </div>
        )}
        {product.product_type && (
          <span className="absolute top-3 left-3 sticker">{product.product_type}</span>
        )}

        <span className="absolute bottom-3 right-3 bg-accent text-accent-foreground font-display text-lg px-3 py-1 border-2 border-foreground">
          FREE
        </span>
      </div>
      <div className="p-4 flex flex-col flex-1 gap-2">
        {product.selling_hook && (
          <p className="text-[10px] font-mono uppercase tracking-widest text-accent-foreground font-bold line-clamp-1">
            {product.selling_hook}
          </p>
        )}
        <h3 className="font-display text-lg uppercase leading-tight line-clamp-2">{product.title}</h3>
        <p className="text-sm text-muted-foreground line-clamp-2 flex-1">
          {product.product_description?.replace(/[#*_>`]/g, "").slice(0, 140) || "Premium PDF, instant download."}
        </p>
        <button
          onClick={handleDownload}
          className="mt-auto w-full h-11 bg-foreground text-background font-display uppercase text-sm tracking-wider border-2 border-foreground hover:bg-accent hover:text-accent-foreground transition-colors flex items-center justify-center gap-2"
        >
          <Download className="h-4 w-4" /> Download
        </button>
      </div>
    </Link>
  );
};

