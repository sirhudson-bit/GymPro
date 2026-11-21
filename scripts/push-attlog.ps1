# ارسال دو رکورد ATTLOG (ورود و خروج) به شنوندهٔ ADMS برنامه
$body = "1`t" + (Get-Date -Format "yyyy-MM-dd") + " 14:20:00`t0`t1`t0`r`n" +
        "1`t" + (Get-Date -Format "yyyy-MM-dd") + " 15:35:00`t1`t1`t0`r`n"
$url = "http://127.0.0.1:8090/iclock/cdata?SN=TEST123456&table=ATTLOG&Stamp=9999"
$res = Invoke-WebRequest -Uri $url -Method Post -Body $body -ContentType "text/plain"
Write-Output ("response: " + $res.Content)
