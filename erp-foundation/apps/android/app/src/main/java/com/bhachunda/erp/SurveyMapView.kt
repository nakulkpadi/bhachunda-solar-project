package com.bhachunda.erp

import android.content.Context
import android.graphics.*
import android.view.*
import androidx.core.graphics.PathParser
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import kotlin.math.*

data class MapBoundary(val id: String,val path: Path,val bounds: RectF,val region: Region)
data class MapLabel(val x: Float,val y: Float,val size: Float,val text: String)
data class MapGeometry(val bounds: RectF,val boundaries: List<MapBoundary>,val labels: List<MapLabel>)
fun parseSurveyMap(context: Context): MapGeometry {
    val parser=XmlPullParserFactory.newInstance().newPullParser()
    val boundaries=mutableListOf<MapBoundary>(); val labels=mutableListOf<MapLabel>(); var box=RectF()
    context.assets.open("survey-map.svg").use { source ->
        parser.setInput(source,"UTF-8")
        while(parser.eventType!=XmlPullParser.END_DOCUMENT) {
            if(parser.eventType==XmlPullParser.START_TAG) when(parser.name) {
                "svg" -> { val n=parser.getAttributeValue(null,"viewBox").trim().split(Regex("[ ,]+" )).map{it.toFloat()}; box=RectF(n[0],n[1],n[0]+n[2],n[1]+n[3]) }
                "path" -> {
                    val id=parser.getAttributeValue(null,"id")
                    val path=PathParser.createPathFromPathData(parser.getAttributeValue(null,"d")) ?: error("Invalid map path")
                    val bounds=RectF(); path.computeBounds(bounds,true)
                    val region=Region(); region.setPath(path,Region(floor(bounds.left).toInt()-1,floor(bounds.top).toInt()-1,ceil(bounds.right).toInt()+1,ceil(bounds.bottom).toInt()+1))
                    boundaries+=MapBoundary(id,path,bounds,region)
                }
                "text" -> { val x=parser.getAttributeValue(null,"x").toFloat(); val y=parser.getAttributeValue(null,"y").toFloat(); val size=parser.getAttributeValue(null,"font-size").toFloat(); val text=parser.nextText(); labels+=MapLabel(x,y,size,text) }
            }
            parser.next()
        }
    }
    check(boundaries.size==990 && labels.size==1074) { "The complete CAD map could not be loaded." }
    return MapGeometry(box,boundaries,labels)
}
class SurveyMapView(context: Context): View(context) {
    var onBoundary: (String)->Unit = {}
    var geometry: MapGeometry?=null; set(value) { field=value; fit(); invalidate() }
    var statuses: Map<String,String> = emptyMap(); set(value) { field=value; invalidate() }
    var selected: Set<String> = emptySet(); set(value) { field=value; invalidate() }
    private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
    private var zoom=1f; private var fitZoom=1f; private var offsetX=0f; private var offsetY=0f
    private val scaleGesture=ScaleGestureDetector(context,object: ScaleGestureDetector.SimpleOnScaleGestureListener() { override fun onScale(detector: ScaleGestureDetector): Boolean { zoomBy(detector.scaleFactor,detector.focusX,detector.focusY); return true } })
    private val gesture=GestureDetector(context,object: GestureDetector.SimpleOnGestureListener() {
        override fun onDown(e: MotionEvent)=true
        override fun onScroll(a: MotionEvent?,b: MotionEvent,distanceX: Float,distanceY: Float): Boolean { if(!scaleGesture.isInProgress && b.pointerCount==1) { offsetX-=distanceX;offsetY-=distanceY;invalidate() }; return true }
        override fun onDoubleTap(e: MotionEvent): Boolean { zoomBy(2f,e.x,e.y); return true }
        override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
            val x=(e.x-offsetX)/zoom; val y=(e.y-offsetY)/zoom
            geometry?.boundaries?.filter { it.bounds.contains(x,y) && it.region.contains(x.roundToInt(),y.roundToInt()) }?.minByOrNull { it.bounds.width()*it.bounds.height() }?.let { selected=setOf(it.id); onBoundary(it.id) }
            performClick(); return true
        }
    })
    init { contentDescription="Complete three village survey map. Pinch to zoom, drag to pan, double tap to zoom, or choose a survey from the finder."; isFocusable=true; setLayerType(LAYER_TYPE_HARDWARE,null) }
    fun fit() { val box=geometry?.bounds ?: return; if(width==0 || height==0) return; val padding=24*resources.displayMetrics.density; fitZoom=min((width-padding*2)/box.width(),(height-padding*2)/box.height()); zoom=fitZoom; offsetX=width/2f-box.centerX()*zoom; offsetY=height/2f-box.centerY()*zoom; invalidate() }
    fun zoomBy(factor: Float,x: Float=width/2f,y: Float=height/2f) { val next=(zoom*factor).coerceIn(fitZoom,fitZoom*80); val wx=(x-offsetX)/zoom; val wy=(y-offsetY)/zoom; zoom=next; offsetX=x-wx*next; offsetY=y-wy*next; invalidate() }
    fun focus(ids: Set<String>) { val regions=geometry?.boundaries?.filter{it.id in ids}.orEmpty(); if(regions.isEmpty()) return; val box=RectF(regions.first().bounds); regions.drop(1).forEach { box.union(it.bounds) }; zoom=min(width/(box.width().coerceAtLeast(30f)*2f),height/(box.height().coerceAtLeast(30f)*2f)).coerceIn(fitZoom,fitZoom*80); offsetX=width/2f-box.centerX()*zoom;offsetY=height/2f-box.centerY()*zoom;selected=ids;invalidate() }
    override fun onSizeChanged(w: Int,h: Int,oldw: Int,oldh: Int) { super.onSizeChanged(w,h,oldw,oldh); fit() }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas); canvas.drawColor(Color.rgb(245,245,239)); val data=geometry ?: return
        val clip=RectF(-offsetX/zoom,-offsetY/zoom,(width-offsetX)/zoom,(height-offsetY)/zoom)
        canvas.save(); canvas.translate(offsetX,offsetY); canvas.scale(zoom,zoom)
        for(boundary in data.boundaries) {
            if(!RectF.intersects(clip,boundary.bounds)) continue
            paint.style=Paint.Style.FILL
            paint.color=when(statuses[boundary.id]) { "received"->Color.rgb(119,187,142);"pending"->Color.rgb(246,210,147);"blocked","rejected"->Color.rgb(220,159,151);else->Color.rgb(226,232,218) }
            canvas.drawPath(boundary.path,paint)
            paint.style=Paint.Style.STROKE; paint.strokeWidth=(if(boundary.id in selected)3f else .85f)/zoom;paint.color=if(boundary.id in selected)Color.rgb(34,85,63) else Color.rgb(126,143,125);canvas.drawPath(boundary.path,paint)
        }
        paint.style=Paint.Style.FILL;paint.typeface=Typeface.create("sans-serif-medium",Typeface.NORMAL);paint.color=Color.rgb(45,68,49)
        for(label in data.labels) { if(!clip.contains(label.x,label.y) || label.size*zoom<5) continue; paint.textSize=label.size; canvas.drawText(label.text,label.x,label.y,paint) }
        canvas.restore()
    }
    override fun onTouchEvent(e: MotionEvent): Boolean { parent?.requestDisallowInterceptTouchEvent(true);scaleGesture.onTouchEvent(e);gesture.onTouchEvent(e);return true }
    override fun performClick(): Boolean { super.performClick();return true }
    override fun onGenericMotionEvent(e: MotionEvent): Boolean { if(e.action==MotionEvent.ACTION_SCROLL) { zoomBy(exp(e.getAxisValue(MotionEvent.AXIS_VSCROLL)*.16f),e.x,e.y);return true };return super.onGenericMotionEvent(e) }
}
@Composable fun MapScreen(state: UiState,onSelect: (String)->Unit) {
    val context=LocalContext.current
    val geometry by produceState<MapGeometry?>(null) { value=withContext(Dispatchers.IO) { parseSurveyMap(context) } }
    var view by remember { mutableStateOf<SurveyMapView?>(null) }; var boundary by remember { mutableStateOf<String?>(null) }; var find by remember { mutableStateOf(false) }; var search by remember { mutableStateOf("") }
    val definitionIds=remember(state.definitions) { state.definitions.associate{it.feature_key to it.svg_element_id} }
    val statusIds=remember(state.statuses,definitionIds) { state.statuses.mapNotNull { row -> definitionIds[row.feature_key]?.let { it to row.status } }.toMap() }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal=18.dp,vertical=10.dp),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically) { Text("Survey map",style=MaterialTheme.typography.titleMedium); TextButton(onClick={find=true}) { Text("Find a survey") } }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if(geometry==null) Loading("Loading the full CAD map…") else AndroidView(factory={SurveyMapView(it).also { v -> view=v;v.geometry=geometry;v.onBoundary={id->boundary=id} }},update={it.statuses=statusIds},modifier=Modifier.fillMaxSize())
            Column(Modifier.align(Alignment.BottomEnd).padding(14.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) { FilledTonalButton(onClick={view?.zoomBy(1.8f)}) {Text("+")};FilledTonalButton(onClick={view?.zoomBy(1/1.8f)}) {Text("−")};FilledTonalButton(onClick={view?.fit()}) {Text("Fit map")} }
        }
        Row(Modifier.fillMaxWidth().padding(16.dp),horizontalArrangement=Arrangement.spacedBy(14.dp)) { StatusPill("received");StatusPill("pending");StatusPill("not_ready") }
        Text("Green means consent received. Pinch to zoom; drag to pan.",Modifier.padding(start=18.dp,end=18.dp,bottom=12.dp),style=MaterialTheme.typography.bodySmall,color=Muted)
    }
    if(boundary!=null) {
        val links=state.links.filter { (it.svg_element_id ?: definitionIds[it.feature_key])==boundary }.distinctBy{it.parcel_id}
        AlertDialog(onDismissRequest={boundary=null},title={Text(if(links.isEmpty())"CAD boundary" else "Linked surveys")},text={Column(verticalArrangement=Arrangement.spacedBy(10.dp)) { if(links.isEmpty()) { Text("This boundary is present in the full DWG but has no imported survey record linked to it.");Hint(boundary.orEmpty()) } else links.forEach { link -> TextButton(onClick={boundary=null;onSelect(link.parcel_id)}) { Text("${link.village_name} · Survey ${link.survey_number}") } } }},confirmButton={TextButton(onClick={boundary=null}){Text("Close")}})
    }
    if(find) AlertDialog(onDismissRequest={find=false},title={Text("Find a survey")},text={Column { Field("Village or survey number",search,{search=it});LazyColumn(Modifier.heightIn(max=340.dp)) { items(state.parcels.filter { "${it.village_name} ${it.survey_number}".contains(search,true) }.take(100),key={it.id}) { row -> TextButton(onClick={val ids=state.links.filter{it.parcel_id==row.id}.mapNotNull{it.svg_element_id ?: definitionIds[it.feature_key]}.toSet(); if(ids.isNotEmpty()) {view?.focus(ids); find=false} else {find=false;onSelect(row.id)}}) {Text("${row.village_name} · ${row.survey_number}")} } } }},confirmButton={TextButton(onClick={find=false}){Text("Close")}})
}
