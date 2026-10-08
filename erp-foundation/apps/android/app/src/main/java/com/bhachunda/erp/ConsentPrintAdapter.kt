package com.bhachunda.erp

import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.*
import java.io.File

class ConsentPrintAdapter(private val pdf:File):PrintDocumentAdapter() {
    override fun onLayout(old:PrintAttributes?,new:PrintAttributes?,cancellation:CancellationSignal?,callback:LayoutResultCallback?,extras:Bundle?) {
        if(cancellation?.isCanceled==true){callback?.onLayoutCancelled();return}
        callback?.onLayoutFinished(PrintDocumentInfo.Builder(pdf.name.substringAfter('-',pdf.name)).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN).build(),true)
    }
    override fun onWrite(pages:Array<out PageRange>?,destination:ParcelFileDescriptor?,cancellation:CancellationSignal?,callback:WriteResultCallback?) {
        try {
            if(cancellation?.isCanceled==true){callback?.onWriteCancelled();return}
            require(destination!=null){"Choose a printer or PDF destination."}
            java.io.FileOutputStream(destination.fileDescriptor).use{out->pdf.inputStream().use{it.copyTo(out)}}
            if(cancellation?.isCanceled==true)callback?.onWriteCancelled() else callback?.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
        }catch(e:Exception){callback?.onWriteFailed("Could not print this generated form.")}
    }
}
