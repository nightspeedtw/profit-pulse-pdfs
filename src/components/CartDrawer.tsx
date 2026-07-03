import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ShoppingCart, Minus, Plus, Trash2, FileText, ArrowRight } from "lucide-react";
import { useCartStore } from "@/stores/cartStore";

export const CartDrawer = () => {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const items = useCartStore((s) => s.items);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const totalItems = items.reduce((s, i) => s + i.quantity, 0);
  const totalPrice = items.reduce((s, i) => s + i.price * i.quantity, 0);

  const handleCheckout = () => {
    setIsOpen(false);
    navigate("/checkout");
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <button
          aria-label="Open cart"
          className="relative h-12 w-12 border-2 border-foreground bg-background hover:bg-highlight transition-colors flex items-center justify-center"
        >
          <ShoppingCart className="h-5 w-5" strokeWidth={2.5} />
          {totalItems > 0 && (
            <span className="absolute -top-2 -right-2 h-6 w-6 bg-accent text-accent-foreground border-2 border-foreground text-xs font-display flex items-center justify-center">
              {totalItems}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg flex flex-col h-full p-0 border-l-2 border-foreground">
        <SheetHeader className="flex-shrink-0 p-6 border-b-2 border-foreground bg-highlight">
          <SheetTitle className="font-display text-2xl uppercase">Your Cart ({totalItems})</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col flex-1 min-h-0">
          {items.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="text-center">
                <div className="mx-auto mb-4 h-16 w-16 border-2 border-foreground flex items-center justify-center">
                  <ShoppingCart className="h-8 w-8" />
                </div>
                <p className="font-display uppercase text-lg">Cart is empty</p>
                <p className="text-muted-foreground text-sm mt-2">Browse the library and add some PDFs</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-6 min-h-0">
                <div className="space-y-4">
                  {items.map((item) => (
                    <div key={item.ebook_id} className="flex gap-3 p-3 border-2 border-foreground bg-card">
                      <div className="w-16 h-16 bg-secondary border-2 border-foreground overflow-hidden flex-shrink-0 flex items-center justify-center">
                        {item.cover_url ? (
                          <img src={item.cover_url} alt={item.title} className="w-full h-full object-cover" />
                        ) : (
                          <FileText className="h-6 w-6" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-display text-sm uppercase truncate leading-tight">{item.title}</h4>
                        <p className="text-xs text-muted-foreground mt-1">Digital PDF</p>
                        <p className="font-display text-base mt-1">${item.price.toFixed(2)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        <button
                          aria-label="Remove"
                          onClick={() => removeItem(item.ebook_id)}
                          className="h-7 w-7 border-2 border-foreground hover:bg-destructive hover:text-destructive-foreground flex items-center justify-center"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                        <div className="flex items-center border-2 border-foreground">
                          <button
                            aria-label="Decrease"
                            onClick={() => setQuantity(item.ebook_id, item.quantity - 1)}
                            className="h-7 w-7 hover:bg-secondary flex items-center justify-center"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-8 text-center text-sm font-display">{item.quantity}</span>
                          <button
                            aria-label="Increase"
                            onClick={() => setQuantity(item.ebook_id, item.quantity + 1)}
                            className="h-7 w-7 hover:bg-secondary flex items-center justify-center"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-shrink-0 space-y-3 p-6 border-t-2 border-foreground bg-secondary">
                <div className="flex justify-between items-baseline">
                  <span className="font-display uppercase text-lg">Total</span>
                  <span className="font-display text-2xl">${totalPrice.toFixed(2)}</span>
                </div>
                <Button
                  onClick={handleCheckout}
                  className="w-full h-14 bg-accent text-accent-foreground hover:bg-accent/90 font-display uppercase tracking-wider border-2 border-foreground rounded-none shadow-brutal hover:shadow-brutal-lg hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all text-base"
                  disabled={items.length === 0}
                >
                  <ArrowRight className="w-4 h-4 mr-2" /> Secure Checkout
                </Button>
                <p className="text-xs text-center text-muted-foreground">Instant download after payment</p>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
