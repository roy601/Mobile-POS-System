import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export function RecentSales() {
  return (
    <div className="space-y-8">
      <div className="flex items-center">
        <Avatar className="h-9 w-9">
          <AvatarImage src="/placeholder.svg?height=36&width=36" alt="Avatar" />
          <AvatarFallback>AH</AvatarFallback>
        </Avatar>
        <div className="ml-4 space-y-1">
          <p className="text-sm font-medium leading-none">আহমেদ হাসান</p>
          <p className="text-sm text-muted-foreground">ahmed.hassan@email.com</p>
        </div>
        <div className="ml-auto font-medium">+৳1,999.00</div>
      </div>
      <div className="flex items-center">
        <Avatar className="flex h-9 w-9 items-center justify-center space-y-0 border">
          <AvatarImage src="/placeholder.svg?height=36&width=36" alt="Avatar" />
          <AvatarFallback>FK</AvatarFallback>
        </Avatar>
        <div className="ml-4 space-y-1">
          <p className="text-sm font-medium leading-none">ফাতিমা খান</p>
          <p className="text-sm text-muted-foreground">fatima.khan@email.com</p>
        </div>
        <div className="ml-auto font-medium">+৳39.00</div>
      </div>
      <div className="flex items-center">
        <Avatar className="h-9 w-9">
          <AvatarImage src="/placeholder.svg?height=36&width=36" alt="Avatar" />
          <AvatarFallback>MA</AvatarFallback>
        </Avatar>
        <div className="ml-4 space-y-1">
          <p className="text-sm font-medium leading-none">মোহাম্মদ আলী</p>
          <p className="text-sm text-muted-foreground">mohammad.ali@email.com</p>
        </div>
        <div className="ml-auto font-medium">+৳299.00</div>
      </div>
      <div className="flex items-center">
        <Avatar className="h-9 w-9">
          <AvatarImage src="/placeholder.svg?height=36&width=36" alt="Avatar" />
          <AvatarFallback>SA</AvatarFallback>
        </Avatar>
        <div className="ml-4 space-y-1">
          <p className="text-sm font-medium leading-none">সারা আহমেদ</p>
          <p className="text-sm text-muted-foreground">sara.ahmed@email.com</p>
        </div>
        <div className="ml-auto font-medium">+৳99.00</div>
      </div>
      <div className="flex items-center">
        <Avatar className="h-9 w-9">
          <AvatarImage src="/placeholder.svg?height=36&width=36" alt="Avatar" />
          <AvatarFallback>RA</AvatarFallback>
        </Avatar>
        <div className="ml-4 space-y-1">
          <p className="text-sm font-medium leading-none">রশিদ আহমেদ</p>
          <p className="text-sm text-muted-foreground">rashid.ahmed@email.com</p>
        </div>
        <div className="ml-auto font-medium">+৳39.00</div>
      </div>
    </div>
  )
}
