"use client";

import { useState } from "react";
import { QrCode, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ProductScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScanResult: (result: string) => void;
}

export function ProductScanner({
  open,
  onOpenChange,
  onScanResult,
}: ProductScannerProps) {
  const [manualCode, setManualCode] = useState("");

  const handleManualEntry = () => {
    if (manualCode.trim()) {
      onScanResult(manualCode.trim());
      onOpenChange(false);
      setManualCode("");
    }
  };

  const simulateScan = () => {
    // Simulate a barcode scan with a random code
    const mockBarcodes = [
      "1234567890123",
      "9876543210987",
      "5555555555555",
      "1111111111111",
    ];
    const randomBarcode =
      mockBarcodes[Math.floor(Math.random() * mockBarcodes.length)];
    onScanResult(randomBarcode);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <QrCode className="mr-2 h-5 w-5" />
            Scan Barcode
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          {/* Camera Preview Simulation */}
          <div className="aspect-video bg-muted rounded-md flex items-center justify-center border-2 border-dashed">
            <div className="text-center">
              <Camera className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-4">
                Camera preview would appear here
              </p>
              <Button onClick={simulateScan}>Simulate Scan</Button>
            </div>
          </div>

          {/* Manual Entry */}
          <div className="space-y-2">
            <Label htmlFor="manual-code">Or enter barcode manually:</Label>
            <div className="flex gap-2">
              <Input
                id="manual-code"
                placeholder="Enter barcode number"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleManualEntry()}
              />
              <Button onClick={handleManualEntry} disabled={!manualCode.trim()}>
                Add
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
