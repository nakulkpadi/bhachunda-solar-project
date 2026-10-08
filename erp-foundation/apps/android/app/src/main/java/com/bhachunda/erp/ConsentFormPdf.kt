package com.bhachunda.erp

import android.content.Context
import android.graphics.*
import android.graphics.pdf.PdfDocument
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import com.google.gson.JsonParser
import java.io.File

// Native PDF drawing uses Android's Gujarati shaping and paginates every block.
fun generateFormPdf(context:Context,draft:FormDraft,target:File):File {
    require(draft.template_version=="bnpl-consent-v1"){"Unsupported form template."}
    val f=draft.fields.validated();val area=formArea(f.has)
    val template=context.assets.open("consent-template.json").bufferedReader().use{JsonParser.parseReader(it).asJsonObject}
    val tokens=mapOf("survey_number" to f.survey_number,"has" to f.has,"village_en" to f.village_en,"village_gu" to f.village_gu,"taluka" to f.taluka,"district" to f.district,"acres" to area.acres.toString(),"guntha" to area.guntha.toString())
    fun filled(s:String)=Regex("\\{\\{(\\w+)\\}\\}").replace(s){tokens[it.groupValues[1]].orEmpty()}
    val pdf=PdfDocument()
    try {
        var page:PdfDocument.Page?=null;var canvas:Canvas?=null;var y=40f;var count=0
        val width=515;val bottom=782f
        fun finish() { page?.let { p ->
            val paint=TextPaint(Paint.ANTI_ALIAS_FLAG).apply{color=Color.DKGRAY;textSize=7.5f}
            val footer="Unsigned generated form · ${draft.id.take(8)} · revision ${draft.revision} · Page $count"
            p.canvas.drawLine(40f,797f,555f,797f,Paint().apply{color=Color.LTGRAY})
            p.canvas.drawText(footer,40f,810f,paint);p.canvas.drawText("Owner signature and verification pending",40f,822f,paint)
            pdf.finishPage(p);page=null
        } }
        fun newPage() { finish();count++;page=pdf.startPage(PdfDocument.PageInfo.Builder(595,842,count).create());canvas=page!!.canvas;y=40f }
        fun layout(text:String,size:Float=10f,bold:Boolean=false,w:Int=width):StaticLayout {
            val p=TextPaint(Paint.ANTI_ALIAS_FLAG).apply{color=Color.BLACK;textSize=size;typeface=Typeface.create("sans-serif",if(bold)Typeface.BOLD else Typeface.NORMAL)}
            return StaticLayout.Builder.obtain(text,0,text.length,p,w).setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(true).setLineSpacing(0f,1.15f).build()
        }
        fun paragraph(text:String,size:Float=10f,bold:Boolean=false,gap:Float=6f) {
            val l=layout(text,size,bold)
            // Split exceptionally long blocks on line boundaries; retain every line.
            var start=0
            while(start<l.lineCount) {
                if(page==null||y+l.getLineBottom(start)-l.getLineTop(start)>bottom)newPage()
                var end=start
                while(end+1<l.lineCount&&y+l.getLineBottom(end+1)-l.getLineTop(start)<=bottom)end++
                val top=l.getLineTop(start).toFloat();val height=l.getLineBottom(end)-top
                canvas!!.save();canvas!!.clipRect(40f,y,555f,y+height);canvas!!.translate(40f,y-top);l.draw(canvas!!);canvas!!.restore();y+=height+gap;start=end+1
            }
        }
        fun tableRow(left:String,right:String,minHeight:Float=0f) {
            val l=layout(left,9.5f,true,205);val r=layout(right,9.5f,false,288);val h=maxOf(l.height.toFloat(),r.height.toFloat(),minHeight)+12f
            if(page==null||y+h>bottom)newPage()
            val stroke=Paint(Paint.ANTI_ALIAS_FLAG).apply{color=Color.GRAY;style=Paint.Style.STROKE;strokeWidth=0.6f}
            canvas!!.drawRect(40f,y,555f,y+h,stroke);canvas!!.drawLine(257f,y,257f,y+h,stroke)
            canvas!!.save();canvas!!.translate(46f,y+6);l.draw(canvas!!);canvas!!.restore();canvas!!.save();canvas!!.translate(263f,y+6);r.draw(canvas!!);canvas!!.restore();y+=h
        }
        fun header(title:String) { paragraph(title,14f,true,10f);paragraph("Date / તારીખ: ${f.date}     Village / ગામ: ${f.village_en} / ${f.village_gu}",9.5f,false,12f) }
        newPage();header(template.value("consent_title"));paragraph("ENGLISH VERSION",10f,true)
        template.array("consent_english").forEach{paragraph(filled(it.asString))};paragraph("GUJARATI VERSION",10f,true)
        template.array("consent_gujarati").forEach{paragraph(filled(it.asString),10.5f)}
        newPage();header("Owners / જમીન માલિકો")
        f.owners.forEachIndexed{i,name->tableRow("${i+1}. $name","Signature / સહી: __________________",36f)}
        y+=14;paragraph("Khata No. / ખાતા નં.: ${f.khata}",11f,true);paragraph("Enclosures / જોડવાના દસ્તાવેજો",11f,true)
        template.array("enclosures").forEachIndexed{i,s->paragraph("${i+1}. ${s.asString}",10.5f)}
        newPage();header(template.value("undertaking_title"))
        template.array("undertaking_gujarati").forEach{paragraph(filled(it.asString),9.3f,false,4f)}
        template.array("undertaking_english").forEach{paragraph(filled(it.asString),9f,false,4f)}
        tableRow("સર્વે નં. / Survey No.",f.survey_number);tableRow("ખાતા નં. / Khata No.",f.khata)
        // Keep many owner names on separate rows so a single row cannot exceed A4.
        f.owners.forEachIndexed{i,name->tableRow("જમીન માલિક / Land Owner ${i+1}",name)}
        tableRow("ગામ / Village","${f.village_en} / ${f.village_gu}");tableRow("તાલુકો / Taluka",f.taluka);tableRow("જીલ્લો / District",f.district);tableRow("મોબાઈલ નં. / Mobile No.",f.mobile)
        y+=16
        if(y+110>bottom)newPage()
        paragraph("સાક્ષીનું નામ / Witness Name: ____________________",10f,false,12f)
        paragraph("સાક્ષીની સહી / Witness Signature: ____________________",10f,false,12f)
        tableRow("PASTE REVENUE TICKET HERE\n(રેવન્યુ સ્ટેમ્પ અહીં ચોંટાડો)","ખેડૂતની સહી / Farmer’s Signature",50f)
        finish();target.parentFile?.mkdirs();target.outputStream().use{pdf.writeTo(it)}
    } finally { pdf.close() }
    return target
}
